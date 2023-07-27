async function getFunctionSignature(hash) {
    const url = `https://raw.githubusercontent.com/ethereum-lists/4bytes/master/signatures/${hash}`;

    const response = await fetch(url);

    if (!response.ok) {
        throw new Error('Signature not found');
    }

    const functionSignature = await response.text();

    return functionSignature;
}

async function decodeTransaction() {
    try {
        const decodeButton = document.getElementById('decodeButton');
        decodeButton.textContent = 'Decoding...';
        decodeButton.disabled = true;

        // Clear the Decoded Transaction area
        document.getElementById('decodedTransaction').textContent = '';
        document.getElementById('output').textContent = '';


        const rpcProvider = document.getElementById('rpcProvider').value;
        const txHash = document.getElementById('txHash').value;

        // Check if txHash is valid 
        if (!/^0x([A-Fa-f0-9]{64})$/.test(txHash)) {
            document.getElementById('failure-alert-message').textContent = 'Invalid transaction hash';
            $('#failure-alert').fadeIn().delay(2000).fadeOut();
            return;
        }

        // 将 hash 添加到 URL 末尾
        if (txHash && (window.location.protocol === 'http:' || window.location.protocol === 'https:')) {
            window.history.pushState({}, '', `./${txHash}`);
        }

        console.log('💪 try to get the tx detail...');

        const response = await fetch(rpcProvider, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                jsonrpc: '2.0',
                method: 'eth_getTransactionByHash',
                params: [txHash],
                id: 1
            })
        });

        const tx = await response.json();

        const fromAddress = tx.result.from;
        const toAddress = tx.result.to;
        const value = parseInt(tx.result.value, 16)/1e18;
        const gas = parseInt(tx.result.gas, 16).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
        const gasPrice = parseInt(tx.result.gasPrice, 16) / 1e9;
        const inputData = tx.result.input;

        const functionSignatureHash = inputData.slice(2, 10);

        console.log('💪 try to get the function signature...');

        let functionSignature = await getFunctionSignature(functionSignatureHash);

        functionSignature = `function ${functionSignature.replace(/\s/g, '')} returns ()`; // Add "function" keyword and empty returns

        const functionName = functionSignature.slice('function '.length, functionSignature.indexOf('('));

        let functionFragment = ethers.utils.Fragment.fromString(functionSignature);
        let parameterTypes = functionFragment.inputs.map(input => input.type);

        console.log("🌟 Signature result: \nfunctionName: " + functionName + "\nparameterTypes: " + parameterTypes);

        let parametersInDefinition = '';
        let parametersInAbi = '';
        let parametersInFunctionCall = '';

        // Ensure parameterTypes is an array before processing
        if (Array.isArray(parameterTypes) && parameterTypes.length > 0) {
            parametersInDefinition = parameterTypes.map((_, index) => `param_${_}_${index + 1}`).join(',');
            parametersInAbi = parameterTypes.map((type, index) => `{"name": "param_${type}_${index + 1}", "type": "${type}"}`).join(',');
            parametersInFunctionCall = parameterTypes.map((_, index) => `param_${_}_${index + 1}`).join(',');
        }

        let pythonCode = `
def ${functionName}(${parametersInDefinition}):
    to_address = web3.to_checksum_address('${toAddress}')
    abi = [{
      "constant": "false",
      "inputs": [${parametersInAbi}],
      "name": "${functionName}",
      "outputs": [],
      "payable": ${value > 0 ? '"true"' : '"false"'},
      "stateMutability": ${value > 0 ? '"payable"' : '"nonpayable"'},
      "type": "function"
    }]
    contract = web3.eth.contract(address=to_address, abi=abi)
    return contract.functions.${functionName}(${parametersInFunctionCall})
`;

        console.log("✅ python code generated");

        console.log('💪 try to decode the parameters...');

        try {
            const abiCoder = new ethers.utils.AbiCoder();
            let params = null;

            if (Array.isArray(parameterTypes)) {
                console.log("Input data: ", '0x' + inputData.slice(10));
                params = abiCoder.decode(parameterTypes, '0x' + inputData.slice(10));
                console.log("Decoded params: ", params);
            }

            let functionCallParams = '';
            let functionParamsObj = [];
            if (params) {
                functionCallParams = params.map((param, index) => {
                    if (Array.isArray(param)) {
                        param = '[]';
                    } else if (ethers.BigNumber.isBigNumber(param)) {
                        param = param.toString();
                    }
                    const key = parameterTypes[index];
                    functionParamsObj.push({ [key]: param });
                    return parameterTypes[index] === 'string' || parameterTypes[index] === 'address' ? `'${param}'` : param;
                }).join(', ');
            }

            const functionParamsObjStr = JSON.stringify(functionParamsObj, null, 2);


            const pythonFunctionCall = `
tx = ${functionName}(${functionCallParams})
print(tx)
`;

            document.getElementById('output').textContent = pythonCode + pythonFunctionCall;
            
            // document.getElementById('decodedTransaction').textContent = "Function Name: " + functionName + "\nFunction Params: " + functionParamsObjStr + "\nFrom Address: " + fromAddress + "\nTo Address: " + toAddress + "\nValue: " + value + "\nGas: " + gas + "\nGasPrice: " + gasPrice + " gWei";

            let decodedTransactionEl = document.getElementById('decodedTransaction');

            let functionParamsHTML = functionParamsObj.map(obj => {
                const key = Object.keys(obj)[0];
                const value = obj[key];
                return `<li><strong>${key}:</strong> ${value}</li>`;
            }).join('');

            decodedTransactionEl.innerHTML = `
    <p><strong>Function Name:</strong> ${functionName}</p>
    <p><strong>Function Params:</strong></p>
    <ul>${functionParamsHTML}</ul>
    <p><strong>From Address:</strong> ${fromAddress}</p>
    <p><strong>To Address:</strong> ${toAddress}</p>
    <p><strong>Value:</strong> ${value}</p>
    <p><strong>Gas:</strong> ${gas}</p>
    <p><strong>GasPrice:</strong> ${gasPrice} gWei</p>
`;






            const codeBlocks = document.querySelectorAll('pre code');
            if (codeBlocks) {
                codeBlocks.forEach((block) => {
                    hljs.highlightElement(block);
                });
            }
            document.getElementById('alert-message').textContent = 'Transaction decoded successfully!';
            $('#success-alert').fadeIn().delay(2000).fadeOut();
        } catch (error) {
            console.log("😭 failed to decode the params via ethers");
            console.log("Failed parameterTypes: ", parameterTypes);
            console.log("Failed data: ", inputData.slice(10));
            document.getElementById('failure-alert-message').textContent = error.message;
            $('#failure-alert').fadeIn().delay(2500).fadeOut();
            return; // Exit function after error
        }

        decodeButton.textContent = 'Decode Transaction';
        decodeButton.disabled = false;
    } catch (error) {
        console.log(error.message);
        document.getElementById('failure-alert-message').textContent = error.message;
        $('#failure-alert').fadeIn().delay(2500).fadeOut();
    } finally {
        document.getElementById('decodeButton').disabled = false;
        document.getElementById('decodeButton').textContent = 'Decode Transaction';
    }
}


// Add a new function that gets the transaction hash from the URL
function getHashFromUrlAndDecode() {
    // Get the navigation entries
    const navigationEntries = window.performance.getEntriesByType('navigation');

    // If there's at least one entry and the last entry's type is 'navigate' (which means the page was loaded normally), proceed
    if (navigationEntries.length > 0 && navigationEntries[navigationEntries.length - 1].type === 'navigate') {
        const url = window.location.href;
        const txHash = url.split('/').pop();

        // If the URL contains a transaction hash, automatically fill in the transaction hash input field and decode the transaction
        if (txHash.startsWith('0x')) {
            document.getElementById('txHash').value = txHash;
            decodeTransaction();
        }
    }
}


