const { Lexer } = require("../src/lexer");
const { Parser } = require("../src/parser");
const { Analyzer } = require("../src/analyzer");
const { CodeGen } = require("../src/codegen");

function compileToWat(source) {
  const tokens = new Lexer(source).scanTokens();
  const ast = new Parser(tokens).parse();
  const functionTable = new Analyzer().analyze(ast);
  return new CodeGen(functionTable).generate(ast);
}

function run(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
  } catch (e) {
    console.log(`FAIL: ${name}`);
    console.log(`  ${e.message}`);
  }
}

function assertContains(haystack, needle, msg) {
  if (!haystack.includes(needle)) {
    throw new Error(`${msg || ""}\n  expected output to contain: ${needle}\n  got:\n${haystack}`);
  }
}

run("emits module with print imports", () => {
  const wat = compileToWat("print(1);");
  assertContains(wat, `(import "env" "print_i32"`);
  assertContains(wat, `(import "env" "print_f32"`);
  assertContains(wat, `(import "env" "print_bool"`);
});

run("emits function with correct param/result signature", () => {
  const wat = compileToWat("fn add(a: int, b: int) -> int { return a + b; }");
  assertContains(wat, `(func $add (param $a i32) (param $b i32) (result i32)`);
  assertContains(wat, `(i32.add (local.get $a) (local.get $b))`);
});

run("emits float locals as f32", () => {
  const wat = compileToWat("fn f(x: float) -> float { return x * 2.0; }");
  assertContains(wat, `(param $x f32)`);
  assertContains(wat, `f32.mul`);
});

run("emits while loop as block+loop+br_if", () => {
  const wat = compileToWat("fn f() { let i = 0; while (i < 5) { i = i + 1; } }");
  assertContains(wat, "(block $exit_0");
  assertContains(wat, "(loop $loop_0");
  assertContains(wat, "br_if $exit_0");
  assertContains(wat, "br $loop_0");
});

run("emits if/else as structured if", () => {
  const wat = compileToWat("fn f(x: int) { if (x > 0) { print(1); } else { print(0); } }");
  assertContains(wat, "(if");
  assertContains(wat, "(then");
  assertContains(wat, "(else");
});

run("exports user functions and main", () => {
  const wat = compileToWat("fn square(x: int) -> int { return x * x; }");
  assertContains(wat, `(export "square" (func $square))`);
  assertContains(wat, `(export "main" (func $main))`);
});

run("collects nested let locals to function top", () => {
  const wat = compileToWat(`
    fn f(x: int) -> int {
      if (x > 0) {
        let y = 1;
        return y;
      }
      return 0;
    }
  `);
  assertContains(wat, "(local $y i32)");
});

run("chooses correct print variant per type", () => {
  const wat = compileToWat("print(1); print(1.5); print(true);");
  assertContains(wat, "call $print_i32");
  assertContains(wat, "call $print_f32");
  assertContains(wat, "call $print_bool");
});
