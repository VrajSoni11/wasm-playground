#!/usr/bin/env node
// CLI driver for the compiler pipeline.
//
// Usage:
//   node compile.js <source-file> [options]
//
// Options:
//   --tokens       print the token stream
//   --ast          pretty-print the AST as JSON
//   --wat          print generated WAT source
//   --run          compile to WASM and execute it (default if no other flag given)
//   --out <file>   write generated WAT to a file instead of stdout
//
// Examples:
//   node compile.js examples/fibonacci.src --run
//   node compile.js examples/fibonacci.src --tokens --ast --wat

const fs = require("fs");
const path = require("path");
const wabtModule = require("wabt");

const { Lexer, LexError } = require("./src/lexer");
const { Parser, ParseError } = require("./src/parser");
const { Analyzer, SemanticError } = require("./src/analyzer");
const { CodeGen } = require("./src/codegen");

function printUsageAndExit() {
  console.log(`Usage: node compile.js <source-file> [options]

Options:
  --tokens       print the token stream
  --ast          pretty-print the AST as JSON
  --wat          print generated WAT source
  --run          compile to WASM and execute it (default if no other flag given)
  --out <file>   write generated WAT to the given file instead of stdout
  -h, --help     show this help message
`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { file: null, tokens: false, ast: false, wat: false, run: false, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") printUsageAndExit();
    else if (a === "--tokens") args.tokens = true;
    else if (a === "--ast") args.ast = true;
    else if (a === "--wat") args.wat = true;
    else if (a === "--run") args.run = true;
    else if (a === "--out") args.out = argv[++i];
    else if (!args.file) args.file = a;
    else printUsageAndExit();
  }
  if (!args.file) printUsageAndExit();
  // If the user didn't ask for any specific phase dump, default to running.
  if (!args.tokens && !args.ast && !args.wat && !args.run) args.run = true;
  return args;
}

// Reports a compiler error the way a real compiler would: a short banner
// plus the phase-specific message (which already includes a line number).
function reportError(phase, err) {
  console.error(`\n✗ ${phase} failed`);
  console.error(`  ${err.message}`);
  process.exit(1);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const sourcePath = path.resolve(args.file);
  if (!fs.existsSync(sourcePath)) {
    console.error(`File not found: ${args.file}`);
    process.exit(1);
  }
  const source = fs.readFileSync(sourcePath, "utf8");

  // ---- Phase 1: Lexing ----
  let tokens;
  try {
    tokens = new Lexer(source).scanTokens();
  } catch (err) {
    if (err instanceof LexError) reportError("Lexical analysis", err);
    throw err;
  }
  if (args.tokens) {
    console.log("=== TOKENS ===");
    for (const t of tokens) console.log(t.toString());
    console.log();
  }

  // ---- Phase 2: Parsing ----
  let ast;
  try {
    ast = new Parser(tokens).parse();
  } catch (err) {
    if (err instanceof ParseError) reportError("Parsing", err);
    throw err;
  }
  if (args.ast) {
    console.log("=== AST ===");
    console.log(JSON.stringify(ast, null, 2));
    console.log();
  }

  // ---- Phase 3: Semantic analysis ----
  let functionTable;
  try {
    functionTable = new Analyzer().analyze(ast);
  } catch (err) {
    if (err instanceof SemanticError) reportError("Semantic analysis", err);
    throw err;
  }
  console.log("✓ Semantic analysis passed (no type errors)\n");

  // ---- Phase 4: Code generation ----
  const wat = new CodeGen(functionTable).generate(ast);
  if (args.wat) {
    console.log("=== GENERATED WAT ===");
    console.log(wat);
    console.log();
  }
  if (args.out) {
    fs.writeFileSync(args.out, wat, "utf8");
    console.log(`WAT written to ${args.out}`);
  }

  // ---- Phase 5: Assemble to WASM binary + execute ----
  if (args.run) {
    const wabt = await wabtModule();
    let wasmModule;
    try {
      wasmModule = wabt.parseWat(path.basename(sourcePath) + ".wat", wat);
    } catch (err) {
      reportError("WAT assembly (this indicates a codegen bug)", err);
    }
    const { buffer } = wasmModule.toBinary({});

    const importObject = {
      env: {
        print_i32: (v) => console.log(v),
        print_f32: (v) => console.log(Math.fround(v)),
        print_bool: (v) => console.log(Boolean(v)),
      },
    };

    console.log("=== PROGRAM OUTPUT ===");
    let instance;
    try {
      ({ instance } = await WebAssembly.instantiate(buffer, importObject));
      instance.exports.main();
    } catch (err) {
      reportError("WASM execution", err);
    }
    console.log("=== END OUTPUT ===");
  }
}

main().catch((err) => {
  console.error("Internal compiler error:", err);
  process.exit(1);
});
