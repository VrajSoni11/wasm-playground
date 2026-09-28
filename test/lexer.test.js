const { Lexer } = require("../src/lexer");

function tokenTypes(source) {
  return new Lexer(source).scanTokens().map((t) => t.type);
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

run("simple let statement", () => {
  const types = tokenTypes("let x = 5;");
  assertEqual(types, ["LET", "IDENT", "ASSIGN", "NUMBER", "SEMICOLON", "EOF"]);
});

run("function declaration with types", () => {
  const types = tokenTypes("fn add(a: int, b: int) -> int { return a + b; }");
  assertEqual(types, [
    "FN", "IDENT", "LPAREN", "IDENT", "COLON", "TYPE_INT", "COMMA",
    "IDENT", "COLON", "TYPE_INT", "RPAREN", "ARROW", "TYPE_INT",
    "LBRACE", "RETURN", "IDENT", "PLUS", "IDENT", "SEMICOLON", "RBRACE", "EOF",
  ]);
});

run("float literal", () => {
  const tokens = new Lexer("3.14").scanTokens();
  assertEqual(tokens[0].literal, { value: 3.14, isFloat: true });
});

run("int literal", () => {
  const tokens = new Lexer("42").scanTokens();
  assertEqual(tokens[0].literal, { value: 42, isFloat: false });
});

run("two-char operators", () => {
  const types = tokenTypes("a == b != c <= d >= e && f || !g");
  assertEqual(types, [
    "IDENT", "EQ", "IDENT", "NEQ", "IDENT", "LTE", "IDENT",
    "GTE", "IDENT", "AND", "IDENT", "OR", "NOT", "IDENT", "EOF",
  ]);
});

run("line comments are skipped", () => {
  const types = tokenTypes("let x = 5; // this is a comment\nlet y = 10;");
  assertEqual(types, [
    "LET", "IDENT", "ASSIGN", "NUMBER", "SEMICOLON",
    "LET", "IDENT", "ASSIGN", "NUMBER", "SEMICOLON", "EOF",
  ]);
});

run("if/else/while/print keywords", () => {
  const types = tokenTypes("if else while print true false");
  assertEqual(types, ["IF", "ELSE", "WHILE", "PRINT", "TRUE", "FALSE", "EOF"]);
});

run("line tracking across newlines", () => {
  const tokens = new Lexer("let x = 1;\nlet y = 2;").scanTokens();
  const yToken = tokens.find((t) => t.lexeme === "y");
  assertEqual(yToken.line, 2, "expected 'y' to be on line 2");
});

run("unexpected character throws LexError", () => {
  let threw = false;
  try {
    new Lexer("let x = @;").scanTokens();
  } catch (e) {
    threw = true;
    assertEqual(e.constructor.name, "LexError");
  }
  if (!threw) throw new Error("expected LexError to be thrown");
});

run("full program tokenizes without error", () => {
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
  const types = tokenTypes(src);
  if (types[types.length - 1] !== "EOF") throw new Error("missing EOF");
  if (types.includes(undefined)) throw new Error("undefined token type found");
});
