const { Lexer } = require("../src/lexer");
const { Parser } = require("../src/parser");
const { Analyzer } = require("../src/analyzer");

function analyze(source) {
  const tokens = new Lexer(source).scanTokens();
  const ast = new Parser(tokens).parse();
  const analyzer = new Analyzer();
  analyzer.analyze(ast);
  return ast;
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

function assertEqual(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg || ""}\n  expected: ${e}\n  actual:   ${a}`);
}

function assertThrows(fn, errClassName, msgContains) {
  let threw = false;
  try {
    fn();
  } catch (e) {
    threw = true;
    if (e.constructor.name !== errClassName) {
      throw new Error(`expected ${errClassName}, got ${e.constructor.name}: ${e.message}`);
    }
    if (msgContains && !e.message.includes(msgContains)) {
      throw new Error(`expected error message to contain "${msgContains}", got: ${e.message}`);
    }
  }
  if (!threw) throw new Error(`expected ${errClassName} to be thrown, nothing was thrown`);
}

// ---- happy paths ----
run("valid fibonacci function type-checks cleanly", () => {
  analyze(`
    fn fib(n: int) -> int {
      if (n <= 1) { return n; }
      return fib(n - 1) + fib(n - 2);
    }
    let result = fib(10);
    print(result);
  `);
});

run("infers variable type from initializer when not annotated", () => {
  const ast = analyze("let x = 5;");
  assertEqual(ast.declarations[0].resolvedType, "int");
});

run("annotates expression nodes with resolvedType", () => {
  const ast = analyze("let x: float = 1.5 + 2.5;");
  assertEqual(ast.declarations[0].initializer.resolvedType, "float");
});

run("allows recursive and mutually-recursive-order function calls", () => {
  analyze(`
    fn isEven(n: int) -> bool { if (n == 0) { return true; } return isOdd(n - 1); }
    fn isOdd(n: int) -> bool { if (n == 0) { return false; } return isEven(n - 1); }
  `);
});

run("allows shadowing in nested block scope", () => {
  analyze(`
    fn f(x: int) -> int {
      if (x > 0) {
        let x = 99;
        print(x);
      }
      return x;
    }
  `);
});

run("bool used as i32 condition works for if/while", () => {
  analyze(`
    fn f() {
      let flag = true;
      while (flag) { flag = false; }
      if (flag == false) { print(1); }
    }
  `);
});

// ---- error cases ----
run("rejects undeclared variable", () => {
  assertThrows(() => analyze("let x = y + 1;"), "SemanticError", "Undeclared variable 'y'");
});

run("rejects mismatched types in arithmetic", () => {
  assertThrows(() => analyze("let x = 1 + true;"), "SemanticError", "requires matching types");
});

run("rejects non-numeric operands in arithmetic (matching but wrong type)", () => {
  assertThrows(() => analyze("let x = true + false;"), "SemanticError", "requires int or float");
});

run("rejects int/float mixing without coercion", () => {
  assertThrows(() => analyze("let x = 1 + 2.0;"), "SemanticError", "requires matching types");
});

run("rejects wrong variable-declaration type annotation", () => {
  assertThrows(() => analyze("let x: bool = 5;"), "SemanticError", "Cannot assign value of type 'int'");
});

run("rejects redeclaration in same scope", () => {
  assertThrows(() => analyze("fn f() { let x = 1; let x = 2; }"), "SemanticError", "already declared");
});

run("rejects call to undeclared function", () => {
  assertThrows(() => analyze("let x = foo(1);"), "SemanticError", "undeclared function 'foo'");
});

run("rejects wrong argument count", () => {
  assertThrows(
    () => analyze("fn add(a: int, b: int) -> int { return a + b; } let x = add(1);"),
    "SemanticError",
    "expects 2 argument"
  );
});

run("rejects wrong argument type", () => {
  assertThrows(
    () => analyze("fn f(a: int) -> int { return a; } let x = f(true);"),
    "SemanticError",
    "Argument 1"
  );
});

run("rejects non-bool if condition", () => {
  assertThrows(() => analyze("fn f() { if (1) { print(1); } }"), "SemanticError", "must be bool");
});

run("rejects non-bool while condition", () => {
  assertThrows(() => analyze("fn f() { while (1) { print(1); } }"), "SemanticError", "must be bool");
});

run("rejects missing return value when return type expected", () => {
  assertThrows(
    () => analyze("fn f() -> int { return; }"),
    "SemanticError",
    "must return a value"
  );
});

run("rejects return value when function is void", () => {
  assertThrows(
    () => analyze("fn f() { return 5; }"),
    "SemanticError",
    "has no return type"
  );
});

run("rejects wrong return type", () => {
  assertThrows(
    () => analyze("fn f() -> int { return true; }"),
    "SemanticError",
    "returns 'int' but got 'bool'"
  );
});

run("rejects using void function result as a value", () => {
  assertThrows(
    () => analyze("fn f() { print(1); } let x = f();"),
    "SemanticError",
    "returns void"
  );
});

run("rejects duplicate function declaration", () => {
  assertThrows(
    () => analyze("fn f() {} fn f() {}"),
    "SemanticError",
    "already declared"
  );
});

run("rejects return outside function", () => {
  assertThrows(() => analyze("return 5;"), "SemanticError", "outside of a function");
});

run("rejects assignment type mismatch", () => {
  assertThrows(
    () => analyze("fn f() { let x = 5; x = true; }"),
    "SemanticError",
    "Cannot assign 'bool'"
  );
});

run("rejects comparing different types", () => {
  assertThrows(() => analyze("let x = 1 == true;"), "SemanticError", "Cannot compare");
});

run("rejects logical operators on non-bool", () => {
  assertThrows(() => analyze("let x = 1 && 2;"), "SemanticError", "requires bool operands");
});
