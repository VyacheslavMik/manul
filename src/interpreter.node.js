const removeSeq = Buffer.from([8, 32, 8]);

let kernel = require('./kernel.js');
let fs = require('fs');

function readFile (fileName, resolve) {
    if (!fs.existsSync(fileName)) {
	setTimeout(() => { resolve(null, ''); }, 0)
    } else {
	fs.readFile(fileName, function (err, data) {
	    content = data.toString();
	    resolve(err, content);
	});
    }
}

function writeFile (fileName, output, resolve) {
    fs.writeFile(fileName, output, resolve);
}

kernel.setWriteFn((outputBuffer) => {
    if (outputBuffer.charCodeAt(0) == 127) {
	process.stdout.write(removeSeq);
    } else {
	process.stdout.write(outputBuffer);
    }
});
kernel.setExitFn(() => { process.exit(); });
kernel.setReadFileFn(readFile);
kernel.setWriteFileFn(writeFile);

process.stdin.setRawMode(true);
process.stdin.on('data', (chunk) => {
    if (chunk.length == 1) {
	kernel.processChar(chunk[0]);
    } else {
	for (let i = 0; i < chunk.length; i++) {
	    kernel.processChar(chunk[i]);
	}
    }
});

kernel.run();
