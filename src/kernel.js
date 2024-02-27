'use strict';

// need to refactor
let memory = [];
let vocabularies = [];

let blks = [];

let blocks = [];

let fileName;
let toInPos = 0;
let tibPos = 0;
let numberTibPos = 0;
let bufferPos = 0;
let bufferStatePos = 0;
let bufferBlockPos = 0;
let blockNumberPos = 0;

let outputBuffer = '';
let isPrintingOutput = false;

let isOnPause = false;
let isWaitingKey = false;
let isSilent = false;

let writeFn;
let exitFn;
let readFileFn;
let writeFileFn;

function readCell (arr, addr) {
    return arr[addr] * 256 + arr[addr + 1];
};

function readCellNum (arr, addr) {
    var sign = arr[addr] & (1 << 7);
    var x = (((arr[addr] & 0xFF) << 8) | (arr[addr + 1] & 0xFF));
    if (sign) {
	x = 0xFFFF0000 | x;  // fill in most significant bits with 1's
    }
    return x;
}

function writeCell (arr, addr, value) {
    arr[addr + 1] = value & 0xFF;
    arr[addr] = (value >> 8) & 0xFF;
}

function stackPushCell (stack, value) {
    if (stack.p + 2 >= stack.limit)
	throw stack.desc + " is overflow";
    writeCell(stack.arr, stack.p, value);
    stack.p += 2;
}

// ------- double numbers ---------- 
// Double numbers are represented on the stack
// with the most-significant 16 bits (with sign) most
// accessible.

// Double numbers are represented in memory by two
// consecutive 16-bit numbers.  The address of the least
// significant 16 bits is two greater than the address of the
// most significant 16 bits.

function readStackDCell (arr, addr) {
    let x = 0 | arr[addr + 2];

    x <<= 8;
    x |= arr[addr + 3];

    x <<= 8;
    x |= arr[addr];

    x <<= 8;
    x |= arr[addr + 1]

    return x >>> 0;
}

function readStackDCellNum (arr, addr) {
    var sign = arr[addr + 2] & (1 << 7);
    let x = 0 | arr[addr + 2];

    x <<= 8;
    x |= arr[addr + 3];

    x <<= 8;
    x |= arr[addr];

    x <<= 8;
    x |= arr[addr + 1]

    if (sign) {
	x = 0xFFFF000000000000 | x;  // fill in most significant bits with 1's
    }

    return x;
}

function writeStackDCell (arr, addr, value) {
    arr[addr + 1] = value & 255;
    arr[addr] = (value >> 8) & 255;
    arr[addr + 3] = (value >> 16) & 255;
    arr[addr + 2] = (value >> 24) & 255;
}

function stackPopDCell (stack) {
    if (stack.p <= 3) {
	throw stack.desc + " is underflow";
    }
    let value = readStackDCell(stack.arr, stack.p - 4);
    stack.p -= 4;
    return value;
}

function stackPopDCellNum (stack) {
    if (stack.p <= 3) {
	throw stack.desc + " is underflow";
    }
    let value = readStackDCellNum(stack.arr, stack.p - 4);
    stack.p -= 4;
    return value;
}

function stackPushDCell (stack, value) {
    if (stack.p + 4 >= stack.limit) {
	throw stack.desc + " is overflow";
    }
    writeStackDCell(stack.arr, stack.p, value)
    stack.p += 4;
}

// ------- end double numbers ---------- 

function stackPopCell (stack) {
    if (stack.p <= 1) {
	throw stack.desc + " is underflow";
    }
    let value = readCell(stack.arr, stack.p - 2);
    stack.p -= 2;
    return value;
}

function stackPopNum (stack) {
    if (stack.p <= 1) {
	throw stack.desc + " is underflow";
    }
    let value = readCellNum(stack.arr, stack.p - 2);
    stack.p -= 2;
    return value;
}

function stackPeekCell (stack) {
    if (stack.p <= 1) {
	throw stack.desc + " is underflow";
    }
    return readCell(stack.arr, stack.p - 2);
}

function readByte (arr, addr) {
    return arr[addr];
}

function writeByte (arr, addr, value) {
    arr[addr] = value & 0xFF;
}

function readString (arr, addr) {
    let count = readCell(arr, addr);
    let value = '';
    for (let i = 0; i < count; i++) {
	value += String.fromCharCode(readByte(arr, addr + i + 2));
    }
    return value;
}

function throwError () {
    let addr = dsPop();
    let count = readByte(memory, addr);
    let value = '';
    for (let i = 0; i < count; i++) {
	value += String.fromCharCode(readByte(memory, addr + i + 1));
    }
    throw value;
}

function writeString (arr, addr, value) {
    writeCell(arr, addr, value.length);
    addr += 2;
    let count = value.length & 0xFFFF;
    for (let i = 0; i < count; i++) {
	writeByte(arr, addr++, value.charCodeAt(i));
    }
}

let functions    = { arr: [], p: 0 };
let ds           = { arr: [], p: 0, desc: "Data stack", limit: 1024 };
let rs           = { arr: [], p: 0, desc: "Return stack", limit: 1024 };

function pushJsFunction (value) {
    if (functions.p == 1024) {
	throw "Assembler vocabulary is overflow";
    }
    functions.arr[functions.p] = value;
    functions.p++;
}

function peekJsFunction (addr) {
    if (addr > functions.p && addr < 0) {
	throw "Assembler peek is out of range";
    }
    return functions.arr[addr];
}

function dsPush (value, type) {
    if (type == 'd') {
	stackPushDCell(ds, value)
    } else if (type == 'b') {
	if (value) {
	    stackPushCell(ds, -1);
	} else {
	    stackPushCell(ds, 0);
	}
    }
    else {
	stackPushCell(ds, value);
    }
}

function dsPop (type) {
    if (type == 'n') {
	return stackPopNum(ds);
    } else if (type == 'd') {
	return stackPopDCellNum(ds);
    } else if (type == 'ud') {
	return stackPopDCell(ds);
    } else {
	return stackPopCell(ds);
    }
}

function dsPeek     ()      { return stackPeekCell(ds);     }

function rsPush   (value) { stackPushCell(rs, value);   }
function rsPop    ()      { return stackPopCell(rs);    }
function rsPeek   ()      { return stackPeekCell(rs);   }

function isImmediate (addr) {
    return memory[addr] == 1;
}

function findVocabulary (name) {
    for (let i = 0; i < vocabularies.length; i++) {
	if (vocabularies[i].name == name) {
	    return i;
	}
    }
}

function vocabulary (name) {
    let idx = findVocabulary(name);
    let vocabulary;
    if (idx == undefined) {
	vocabulary = {name: name, word: 0};
    } else {
	vocabulary = vocabularies[idx];
	vocabularies.splice(idx, 1);
    }
    vocabularies.unshift(vocabulary);
}

function definitions () {
    env.compilationVocabulary = vocabularies[0];
}

// Dictionary entry
// flags                    - 1 byte
// link to previous word    - 1 cell
// name
//   count                  - 1 cell
//   string                 - <count> bytes
// code pointer             - 1 cell
// data field               - cells with data

function entry (name) {
    let lastWord = env.compilationVocabulary.word;
    env.compilationVocabulary.word = env.dp;

    memWriteNextByte(0);           // flags
    memWriteNextCell(lastWord);    // link to previous word
    memWriteNextString(name);      // word name
}

function isControlChar(c) {
    return c < 32 || c == 127;
}

function popBlock() {
    let blk = blks.pop();
    if (blk.num != 0) {
	dsPush(blk.num);
	block();
	dsPop();
    }
    writeByte(memory, blockNumberPos, blk.num);
    writeCell(memory, toInPos, blk.toIn);
}

function readWord () {
    while (true) {
	let blk = readByte(memory, blockNumberPos);
	let limit = 0;
	if (blk > 0) {
	    limit = 1025;
	} else {
	    limit = readCell(memory, numberTibPos);
	}

	let toIn = readCell(memory, toInPos);

	// input exhausted
	if (blks.length == 0 && toIn >= limit) {
	    return '';
	}

	let pos = 0;
	if (blk > 0) {
	    limit = bufferPos + limit;
	    pos = bufferPos + toIn;
	} else {
	    limit = tibPos + limit;
	    pos = tibPos + toIn;
	}

	for (; pos < limit; pos++, toIn++) {
	    if (!isControlChar(memory[pos]) && memory[pos] != 32) {
		break;
	    }
	}

	let word = '';
	for (; pos < limit; pos++, toIn++) {
	    if (isControlChar(memory[pos]) || memory[pos] == 32) {
		writeCell(memory, toInPos, toIn);
		return word;
	    } else {
		word += String.fromCharCode(memory[pos]);
	    }
	}

	writeCell(memory, toInPos, toIn);

	if (word != '') {
	    return word;
	}

	if (blks.length != 0) {
	    popBlock();
	}
    }
}

function isBufferUpdated () {
    return memory[bufferStatePos] == 1;
}

function saveBuffers () {
    if (isBufferUpdated()) {
	let blk = readByte(memory, bufferBlockPos) - 1;
	let arr = [];
	for (let i = 0; i < 1024; i++) {
	    let c = 32;
	    if (memory[bufferPos + i] != undefined) {
		c = memory[bufferPos + i];
	    }
	    arr[i] = c;
	}
	blocks[blk] = arr;
	memory[bufferStatePos] = 0;
	saveFile();
    }
}

function flush () {
    saveBuffers();
    writeByte(memory, bufferBlockPos, 0);
}

function bufferUpdate () {
    memory[bufferStatePos] = 1;
}

function block () {
    let u = dsPop();

    if (u == 0) {
	throw '0 block is denied';
    }
    
    let blk = readByte(memory, bufferBlockPos);

    if (u != blk) {
	saveBuffers();

	let arr = [];
	let c = 32;
	if (blocks[u - 1] != undefined) {
	    arr = blocks[u - 1];
	}
	for (let i = 0; i < 1024; i++) {
	    if (arr[i] == undefined) {
		c = 32;
	    } else {
		c = arr[i];
	    }
	    memory[bufferPos + i] = c;
	}
	writeByte(memory, bufferBlockPos, u);
    }
    dsPush(bufferPos);
}

function load () {
    let u = dsPeek();
    let blk = readByte(memory, blockNumberPos);
    let toIn = readCell(memory, toInPos);

    block();
    dsPop();

    blks.push({ num: blk, toIn: toIn });

    writeByte(memory, blockNumberPos, u);
    writeCell(memory, toInPos, 0);
}

function findWord (name) {
    for (var i = 0; i < vocabularies.length; i++) {
	let wordAddr = vocabularies[i].word;
	while (wordAddr > 0) {
	    let wordNameAddr = wordAddr + 1 + 2;
	    let wordName = readString(memory, wordNameAddr);
	    if (name == wordName) {
		return wordAddr;
	    } else {
		wordAddr = readCell(memory, wordAddr + 1);
	    }
	}
    }
}

function abortPrintStack () {
    if (rs.p > 0) {
	printLast('Backtrace:');
    }
    let words = [];
    for (var i = 0; i < vocabularies.length; i++) {
	let addr = vocabularies[i].word;
	while (addr > 0) {
	    words[addr] = true;
	    addr = readCell(memory, addr + 1);
	}
    }
    while (rs.p > 0) {
	let xt = rsPop();
	let addr = xt;
	while (addr > 0) {
	    if (words[addr]) {
		let name = readString(memory, addr + 1 + 2);
		printLast(xt + ' ' + name);
		break;
	    }
	    addr--;
	}
    }
}

function abort (err) {
    printLast('');
    if (err) {
	printLast('Error: ' + err);
    }
    abortPrintStack();
    printOutput();
    writeCell(memory, numberTibPos, 0);
    writeCell(memory, toInPos,  0);
    writeByte(memory, blockNumberPos, 0);
    writeByte(memory, 0, 0);
    ds.p = 0;
    rs.p = 0;
    isOnPause = true;
}

function printValue (v) {
    outputBuffer += v + ' ';
}

function printChar (c) {
    outputBuffer += String.fromCharCode(c);
}

function printLast (v) {
    outputBuffer += v + '\n';
}

function writeOutput (outputBuffer) {
    if (writeFn != undefined) {
	writeFn(outputBuffer);
    }
}

function printOutput () {
    if (!isSilent) {
	writeOutput(outputBuffer);
    }
    isSilent = false;
    outputBuffer = '';
}

function pause() {
    isOnPause = true;
    printOutput();
}

function resume() {
    isOnPause = false;
    isWaitingKey = false;

    try {
	addressInterpreter();
	textInterpreter();
    } catch (err) {
	abort(err);
    }
}

function waitKey() {
    pause();
    isWaitingKey = true;
}

function exit(err) {
    if (exitFn != undefined) {
	exitFn(err);
    }
}

function processChar(c) {
    if (c == 3)  exit();
    if (isWaitingKey) {
	dsPush(c);
	resume();
    } else {
	if (c == 13) {
	    outputBuffer = ' ' + outputBuffer;

	    if (!isWaitingKey) {
		resume();
	    }
	} else if (c == 127) {
	    let ntib = readCell(memory, numberTibPos);
	    if (ntib > 0) {
		writeCell(memory, numberTibPos, ntib - 1);
	    }
	    writeOutput(String.fromCharCode(c));
	} else {
	    writeByte(memory, tibPos + readCell(memory, numberTibPos), c);
	    writeCell(memory, numberTibPos, readCell(memory, numberTibPos) + 1);
	    writeOutput(String.fromCharCode(c));
	}
    }
}

function printStack (stack) {
    let count = stack.p / 2;
    let output = '<' + count + '>';
    for (var i = 0; i < count; i++) {
	let v = readCell(stack.arr, 2 * i);
	if (v > 32767) { v -= 65536; }
	output += ' ' + v;
    }
    printValue(output);
}

function memWriteNextByte (value) {
    writeByte(memory, env.dp, value);
    env.dp += 1;
}

function memWriteNextCell (value) {
    writeCell(memory, env.dp, value);
    env.dp += 2;
}

function memWriteNextString (value) {
    memWriteNextCell(value.length);
    let count = value.length & 0xFFFFFFFF;
    for (let i = 0; i < count; i++) {
	memWriteNextByte(value.charCodeAt(i));
    }
}

function memReadString (addr) {
    return readString(memory, addr);
}

function find () {
    let saddr = dsPop();
    let count = readByte(memory, saddr);
    let str = '';
    for (let i = 0; i < count; i++) {
	str += String.fromCharCode(readByte(memory, saddr + i + 1));
    }
    let waddr = findWord(str);
    if (waddr == undefined) {
	dsPush(saddr);
	dsPush(0);
    } else {
	let caddr = toBody(waddr);
	dsPush(caddr);
	if (isImmediate(waddr)) {
	    dsPush(1);
	} else {
	    dsPush(-1);
	}
    }
}

function pruneVocabulary (addr, vocabulary) {
    let wordAddr = vocabulary.word;
    while (wordAddr > 0) {
	if (wordAddr < addr) {
	    vocabulary.word = wordAddr;
	    return;
	}
	wordAddr = readCell(memory, wordAddr + 1);
    }
    vocabulary.word = 0;
}

function forget () {
    let word = readWord();
    let wordAddr = env.compilationVocabulary.word;
    while (wordAddr > 0) {
	let nameAddr = wordAddr + 1 + 2;
	let name = readString(memory, nameAddr);
	if (name == word) {
	    break;
	} else {
	    wordAddr = readCell(memory, wordAddr + 1);
	}
    }
    if (wordAddr == 0) {
	throw 'Word not found: ' + word;
    }
    for (let i = 0; i < vocabularies.length; i++) {
	pruneVocabulary(wordAddr, vocabularies[i]);
    }
    env.dp = wordAddr;
}

let env = {memory:                memory,
	   rs:                    rs,
	   ds:                    ds,
	   dp:                    0,

	   functions:             functions,
	   jsEntry:               jsEntry,
	   entry:                 entry,
	   vocabulary:            vocabulary,
	   definitions:           definitions,
	   compilationVocabulary: undefined,
	   semicolonCode:         semicolonCode,

	   pause:                 pause,
	   resume:                resume,
	   waitKey:               waitKey,
	   backslash:             backslash,

	   findWord:              findWord,
	   printStack:            printStack,
	   printValue:            printValue,
	   printChar:             printChar,

	   readCell:              readCell,
	   writeCell:             writeCell,

	   readByte:              readByte,
	   writeByte:             writeByte,

	   memWriteNextByte:      memWriteNextByte,
	   memWriteNextCell:      memWriteNextCell,
	   memWriteNextString:    memWriteNextString,

	   memReadString:         memReadString,

	   toBody:                toBody,
	   abort:                 abort,
	   throwError:            throwError,

	   dsPop:                 dsPop,
	   dsPush:                dsPush,
	   dsPeek:                dsPeek,

	   rsPush:                rsPush,
	   rsPop:                 rsPop,
	   rsPeek:                rsPeek,

	   block:                 block,
	   saveBuffers:           saveBuffers,
	   bufferUpdate:          bufferUpdate,
	   flush:                 flush,
	   load:                  load,
	   use:                   use,
	   readWord:              readWord,
	   find:                  find,
	   forget:                forget};

function makeJsFunction (str) {
    return Function('env', str);
}

function jsEntry (name, code) {
    vocabulary("assembler");
    entry(name);
    memWriteNextCell(1);
    memWriteNextCell(functions.p);
    pushJsFunction(makeJsFunction(code));
}

function addressInterpreter () {
    let codeAddr = 0;
    try {
	while (rs.p > 0) {
	    if (isOnPause) break;

	    codeAddr = rsPop();
	    let code = readCell(memory, codeAddr);
	    if (code == 1) {
		let jsPointer = readCell(memory, codeAddr + 2);
		let fn = peekJsFunction(jsPointer);
		fn(env);
	    } else if (code == 2) {
		let codePointer = readCell(memory, codeAddr + 2);
		rsPush(codeAddr + 4);
		rsPush(codePointer);
	    } else if (code == 3) {
		let integer = readCell(memory, codeAddr + 2);
		rsPush(codeAddr + 4);
		dsPush(integer);
	    } else {
		throw 'Unabled to process code: ' + code;
	    }
	}
    } catch (err) {
	if (codeAddr > 0) {
	    rsPush(codeAddr);
	}
	throw err;
    }
}

function toBody (wordAddr) {
    return wordAddr + 1 + 2 + 2 + readCell(memory, wordAddr + 1 + 2);
}

function dump () {
    printLast("\n------------");
    let flag = dsPop();
    if (flag > 9 || flag < 1) {
	printLast("end start 1 - memory.slice(start, end)");
	printLast("          2 - functions");
	printLast("          3 - ds");
	printLast("          4 - rs");
	printLast("          5 - vocabularies");
	printLast("          6 - blk");
	printLast("          7 - blocks")
	printLast("          8 - word");
	printLast("          9 - vocabulary words");
    }
    if (flag == 1) {
	let start = dsPop();
	let end   = dsPop();
	printValue(memory.slice(start, end));
    }
    if (flag == 2) {
	printValue(functions);
    }
    if (flag == 3) {
	printValue('p: ' + ds.p + ' arr: ' + ds.arr);
    }
    if (flag == 4) {
	printValue(rs);
    }
    if (flag == 5) {
	printValue(vocabularies);
    }
    if (flag == 6) {
	printValue(blk);
    }
    if (flag == 7) {
	printValue(blocks);
    }
    if (flag == 8) {
	let word = readWord();
	if (word == '') {
	    printValue('Specify word');
	    return;
	}
	let wordAddr = findWord(word);
	if (wordAddr == undefined) {
	    printValue('Word not found: ' + word);
	    return;
	}

	let exitWord = findWord('exit');
	if (exitWord == undefined) {
	    printValue('Word exit is not found');
	    return;
	}
	
	let exitXt = toBody(exitWord);
	let wordXt = toBody(wordAddr);
	let output = '';
	let cell = 0;
	do {
	    cell = readCell(memory, wordXt);
	    if (cell == 1) {
		output += '[a]';
	    } else if (cell == 2) {
		output += '[c]';
	    } else if (cell == 3) {
		output += '[l]';
	    } else {
		output += '[' + cell + ']';
	    }
	    wordXt += 2;
	    cell = readCell(memory, wordXt);
	    wordXt += 2;
	    output += cell + ' ';
	}
	while (cell != exitXt && cell != undefined);

	printValue(output);
    }
    if (flag == 9) {
	let word = readWord();
	if (word == '') {
	    printValue('Specify vocabulary');
	    return;
	}
	let idx = findVocabulary(word);
	if (idx == undefined) {
	    printValue('Vocabulary not found: ' + word);
	    return;
	}

	let output = '';
	let wordAddr = vocabularies[idx].word;
	while (wordAddr > 0) {
	    let wordNameAddr = wordAddr + 1 + 2;
	    let wordName = readString(memory, wordNameAddr);
	    output += wordName + ' ';
	    wordAddr = readCell(memory, wordAddr + 1);
	}

	printValue(output);
    }
}

function readFile (fileName, resolve) {
    if (readFileFn != undefined) {
	readFileFn(fileName, resolve);
    }
}

function use (name) {
    pause();

    blocks = [];
    writeByte(memory, bufferBlockPos, 0);
    writeByte(memory, blockNumberPos, 0);

    readFile(name, function (err, content) {
	if (err) {
	    abort(err);
	    return;
	}
	fileName = name;
	let count = Math.ceil(content.length / 1024);

	for (var i = 0; i < count; i++) {
	    let arr = [];
	    let str = content.substring(i * 1024, (i + 1) * 1024);
	    writeString(arr, 0, str);
	    arr.shift();
	    arr.shift();
	    blocks[i] = arr;
	}

	resume();
    });
}

function writeFile (output, resolve) {
    if (writeFileFn != undefined) {
	writeFileFn(fileName, output, resolve);
    }
}

function saveFile () {
    let output = '';
    for(let i = 0; i < blocks.length; i++) {
	for (let j = 0; j < 1024; j++) {
	    if (blocks[i] == undefined || blocks[i][j] == undefined) {
		output += ' ';
	    } else {
		output += String.fromCharCode(blocks[i][j]);
	    }
	}
    }
    pause();
    writeFile(output, function(err) {
	if(err) {
	    abort(err);
	    return;
	}
	resume();
    }); 
}

function parseInteger (str) {
    for (var i = 0; i < str.length; i++) {
	if (i == 0 && str[i] == '-') {
	    continue;
	}
	if (str[i] < '0' || str[i] > '9') {
	    return undefined;
	}
    }
    return parseInt(str);
}

function textInterpreter () {
    let message = 'ok';
    let word = readWord();
    while (!isOnPause && word != '') {
	let wordAddr = findWord(word);
	if (wordAddr != undefined && isImmediate(wordAddr) && memory[1] == 0) {
	    rsPush(toBody(wordAddr));
	    addressInterpreter();
	    message = 'ok';
	} else if (memory[0] == 0) {
	    if (word == 'bye') {
		exit();
		break;
	    } else if (word == 'dump') {
		dump();
		message = 'ok';
	    } else if (word != '') {
		if (wordAddr == undefined) {
		    let integer = parseInteger(word);
		    if (integer == undefined) {
			throw 'Word is not found: ' + word;
		    } else {
			dsPush(integer);
		    }
		} else {
		    rsPush(toBody(wordAddr));
		    addressInterpreter();
		    message = 'ok';
		}
	    } else {
		message = 'ok';
	    }
	} else {
	    if (memory[1] != 0) {
		if (word != 'end-code') {
		    memory[1].code += ' ' + word;
		    message = 'compiled';
		} else {
		    rsPush(toBody(wordAddr));
		    addressInterpreter();
		    message = 'ok';
		}
	    } else if (memory[2] != 0) {
		if (wordAddr == undefined) {
		    let integer = parseInteger(word);
		    if (integer == undefined) {
			throw 'Word is not found: ' + word;
		    } else {
			memWriteNextCell(3);
			memWriteNextCell(integer);
			message = 'compiled';
		    }
		} else {
		    memWriteNextCell(2);
		    memWriteNextCell(toBody(wordAddr));
		    message = 'compiled';
		}
	    } else {
		throw 'What is compiling?!';
	    }
	}
	if (!isOnPause) {
	    word = readWord();
	}
    }

    if (!isOnPause) {
	printLast(' ' + message);
	pause();
	writeCell(memory, toInPos, 0);
	writeCell(memory, numberTibPos, 0);
    }
}

memWriteNextByte(0); 		// compilation state
memWriteNextByte(0);		// first byte is empty and define an assembler word;
memWriteNextByte(0);		// second byte is empty and define an execute word;
memWriteNextByte(0);		// third byte is empty and define an literal word;

toInPos = env.dp;
memWriteNextCell(0);               // >in

numberTibPos = env.dp;
memWriteNextCell(0);

tibPos = env.dp;
for (let i = 0; i < 1024; i++) {        // tib
    memWriteNextByte(0);
}

bufferPos = env.dp;
for (let i = 0; i < 1024; i++) {        // buffer
    memWriteNextByte(0);
}

bufferStatePos = env.dp;
memWriteNextByte(0);               // buffer state

bufferBlockPos = env.dp;
memWriteNextByte(0);               // buffer block state

blockNumberPos = env.dp;
memWriteNextByte(0);               // block number

vocabulary("assembler"); definitions();

jsEntry("code", `
let name = env.readWord();
if (name.trim() == '') {
    throw 'Empty string for name';
}
env.memory[0] = 1;
env.memory[1] = {
                  name: name,
                  code: '',
                  make: function(v) {
                            env.jsEntry(v.name, v.code);
                        }
                };
`);

function semicolonCode (v) {
    pushJsFunction(makeJsFunction(v.code))
}

jsEntry(";code", `
let w = env.toBody(env.findWord('does>'));
env.memWriteNextCell(2);
env.memWriteNextCell(w);
env.memWriteNextCell(1);
env.memWriteNextCell(env.functions.p);
w = env.toBody(env.findWord('exit'));
env.memWriteNextCell(2);
env.memWriteNextCell(w);
env.memory[0] = 1;
env.memory[2] = 0;
env.memory[1] = {
                  code: '',
                  make: env.semicolonCode
                };
`);

memory[env.compilationVocabulary.word] = 1;

jsEntry('end-code', `
env.memory[1].make(env.memory[1]);
env.memory[0] = 0;
env.memory[1] = 0;
`);

vocabulary("forth"); definitions();

function backslash () {
    writeCell(memory, toInPos, (Math.floor(readCell(memory, toInPos) / 64) + 1) * 64);
}

jsEntry('\\', `env.backslash();`);
jsEntry('load', `env.load();`);

outputBuffer =
    'Welcome to forth interpreter prototype\n' +
    'Type \'bye\' to exit\n\n';

env.numberTibPos   = numberTibPos;
env.toInPos        = toInPos;
env.blockNumberPos = blockNumberPos;
env.tibPos         = tibPos;

function placeOnTib(str) {
    let arr = [];
    writeString(arr, 0, str);
    for (let i = 2; i < arr.length; i++) {
	writeByte(memory, tibPos + i - 2, arr[i]);
    }
    writeCell(memory, numberTibPos, arr.length - 2);
}

function execute (str) {
    placeOnTib(str);
    resume();
}

function run () {
    use('core.f');
    isSilent = true;
    placeOnTib('1 load');    
}

module.exports = {
    processChar, run, execute,
    setWriteFn: (v) => { writeFn = v },
    setExitFn: (v) => { exitFn = v },
    setWriteFileFn: (v) => { writeFileFn = v },
    setReadFileFn: (v) => { readFileFn = v },
    isOnPause: () => { return isOnPause; },
    isWaitingKey: () => { return isWaitingKey; }
};
