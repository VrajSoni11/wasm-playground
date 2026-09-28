const { Lexer } = require("../src/lexer");
const { Parser } = require("../src/parser");

function parse(source) {
  const tokens = new Lexer(source).scanTokens();
  return new Parser(tokens).parse();
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
  if (a !== e) {
    throw new Error(`${msg || ""}\n  expected: ${e}\n  actual:   ${a}`);
  }
}

run("parses a variable declaration", () => {
  const ast = parse("let x: int = 5;");
  const decl = ast.declarations[0];
  assertEqual(decl.type, "VarDecl");
  assertEqual(decl.name, "x");
  assertEqual(decl.varType, "int");
  assertEqual(decl.initializer, { type: "NumberLit", value: 5, isFloat: false, line: 1 });
});

run("parses arithmetic with correct precedence", () => {
  // 1 + 2 * 3 should parse as 1 + (2 * 3)
  const ast = parse("let x = 1 + 2 * 3;");
  const expr = ast.declarations[0].initializer;
  assertEqual(expr.op, "+");
  assertEqual(expr.left.type, "NumberLit");
  assertEqual(expr.right.type, "Binary");
  assertEqual(expr.right.op, "*");
});

run("parses parenthesized expressions overriding precedence", () => {
  // (1 + 2) * 3 should parse as (1 + 2) * 3, top op is *
  const ast = parse("let x = (1 + 2) * 3;");
  const expr = ast.declarations[0].initializer;
  assertEqual(expr.op, "*");
  assertEqual(expr.left.op, "+");
});

run("parses a function declaration with params and return type", () => {
  const ast = parse("fn add(a: int, b: int) -> int { return a + b; }");
  const fn = ast.declarations[0];
  assertEqual(fn.type, "FuncDecl");
  assertEqual(fn.name, "add");
  assertEqual(fn.params, [
    { type: "Param", name: "a", paramType: "int" },
    { type: "Param", name: "b", paramType: "int" },
  ]);
  assertEqual(fn.returnType, "int");
  assertEqual(fn.body.statements[0].type, "ReturnStmt");
});

run("parses if/else", () => {
  const ast = parse("fn f() { if (x < 1) { print(1); } else { print(2); } }");
  const ifStmt = ast.declarations[0].body.statements[0];
  assertEqual(ifStmt.type, "IfStmt");
  assertEqual(ifStmt.condition.op, "<");
  assertEqual(ifStmt.thenBranch.statements[0].type, "PrintStmt");
  assertEqual(ifStmt.elseBranch.statements[0].type, "PrintStmt");
});

run("parses while loop", () => {
  const ast = parse("fn f() { while (x < 10) { x = x + 1; } }");
  const whileStmt = ast.declarations[0].body.statements[0];
  assertEqual(whileStmt.type, "WhileStmt");
  assertEqual(whileStmt.body.statements[0].type, "ExprStmt");
  assertEqual(whileStmt.body.statements[0].expression.type, "Assign");
});

run("parses function calls including recursion", () => {
  const ast = parse("fn fib(n: int) -> int { return fib(n - 1); }");
  const ret = ast.declarations[0].body.statements[0];
  assertEqual(ret.value.type, "Call");
  assertEqual(ret.value.callee, "fib");
  assertEqual(ret.value.args[0].type, "Binary");
});

run("parses logical operators with correct precedence", () => {
  // a || b && c should parse as a || (b && c)  since && binds tighter
  const ast = parse("let x = a || b && c;");
  const expr = ast.declarations[0].initializer;
  assertEqual(expr.type, "Logical");
  assertEqual(expr.op, "||");
  assertEqual(expr.right.type, "Logical");
  assertEqual(expr.right.op, "&&");
});

run("parses unary minus and not", () => {
  const ast = parse("let x = -5; let y = !true;");
  assertEqual(ast.declarations[0].initializer, { type: "Unary", op: "-", operand: { type: "NumberLit", value: 5, isFloat: false, line: 1 }, line: 1 });
  assertEqual(ast.declarations[1].initializer.op, "!");
});

run("full fibonacci program parses end to end", () => {
  const src = `
    fn fib(n: int) -> int {
      if (n <= 1) {
        return n;
      } else {
        return fib(n - 1) + fib(n - 2);
      }
    }
    let result = fib(10);
    print(result);
  `;
  const ast = parse(src);
  assertEqual(ast.declarations.length, 3);
  assertEqual(ast.declarations[0].type, "FuncDecl");
  assertEqual(ast.declarations[1].type, "VarDecl");
  assertEqual(ast.declarations[2].type, "PrintStmt");
});

run("throws ParseError on malformed input", () => {
  let threw = false;
  try {
    parse("let x = ;");
  } catch (e) {
    threw = true;
    assertEqual(e.constructor.name, "ParseError");
  }
  if (!threw) throw new Error("expected ParseError to be thrown");
});

run("throws ParseError on invalid assignment target", () => {
  let threw = false;
  try {
    parse("let x = 5 = 6;");
  } catch (e) {
    threw = true;
    assertEqual(e.constructor.name, "ParseError");
  }
  if (!threw) throw new Error("expected ParseError to be thrown");
});

// Handy for your report: dump a full AST as pretty JSON
run("[demo] pretty-print AST for fib program", () => {
  const ast = parse("fn fib(n: int) -> int { if (n <= 1) { return n; } return fib(n-1) + fib(n-2); }");
  console.log(JSON.stringify(ast, null, 2).slice(0, 400) + "\n  ... (truncated)");
});
