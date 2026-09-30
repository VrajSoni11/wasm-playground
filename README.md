# WebAssembly Compiler Pipeline

A mini-compiler for a small custom programming language that compiles source
code down to **WebAssembly**, plus a command-line tool and a browser-based
playground to run the compiled programs.

Built for a Compiler Design course project. The compiler is written from
scratch in JavaScript and implements every classical compiler phase:

```
Source Code (.src)
      │
      ▼
  ┌────────┐   tokens    ┌────────┐   AST    ┌───────────┐  annotated AST  ┌─────────┐   WAT text   ┌───────────┐
  │ Lexer  │ ──────────► │ Parser │ ───────► │ Semantic  │ ──────────────► │ Codegen │ ───────────► │  wat2wasm │
  │        │             │        │          │ Analyzer  │                 │         │              │  (wabt)   │
  └────────┘             └────────┘          └───────────┘                 └─────────┘              └─────┬─────┘
                                                                                                            │ .wasm binary
                                                                                                            ▼
                                                                                            ┌───────────────────────────┐
                                                                                            │ WebAssembly.instantiate() │
                                                                                            │  (Node.js or Browser)     │
                                                                                            └───────────────────────────┘
```

## What's in this project

| Phase | File | What it does |
|---|---|---|
| 1. Lexical Analysis | `src/lexer.js`, `src/tokens.js` | Hand-written scanner: source text → token stream |
| 2. Syntax Analysis | `src/parser.js`, `src/ast.js` | Recursive-descent parser: tokens → AST |
| 3. Semantic Analysis | `src/analyzer.js`, `src/scope.js` | Scope resolution, type checking, return-path checking |
| 4. Code Generation | `src/codegen.js` | AST → WebAssembly Text format (WAT) |
| 5. Assembly + Execution | `compile.js`, `playground/` | WAT → WASM binary (via `wabt`) → run in Node or browser |

We deliberately generate **WAT (WebAssembly Text format)** rather than
hand-encoding the raw binary format ourselves, then use the `wabt` library
(WebAssembly Binary Toolkit) to assemble WAT into a `.wasm` binary. This lets
the project focus on the compiler-theory parts that matter for this
course — lexing, parsing, type checking, and instruction-selection codegen —
rather than on LEB128 varint encoding and binary section layout, which is
mechanical rather than conceptual.

---

## The source language

A small statically-typed, C-like language, intentionally scoped to be
implementable and demoable within a few weeks:

- **Types:** `int` (→ WASM `i32`), `float` (→ WASM `f32`), `bool` (→ WASM `i32`, 0/1)
- **Variables:** `let x = 5;` or `let x: int = 5;` (type either annotated or inferred)
- **Functions:** with typed parameters and return types, including recursion
- **Control flow:** `if` / `else` / `else if`, `while` loops
- **Operators:** `+ - * /`, comparisons (`< > <= >= == !=`), logical (`&& || !`), unary `-`
- **I/O:** `print(expr)` — implemented as an imported host function, since WASM has no native I/O

No implicit type coercion between `int` and `float` — this is a deliberate
simplification; see "Known Limitations" below.


Every phase's output can be dumped for demonstration purposes:

| Flag | Shows |
|---|---|
| `--tokens` | The token stream from the lexer |
| `--ast` | The parsed AST as JSON |
| `--wat` | The generated WebAssembly Text |
| `--run` | Assembles to WASM and executes it (default if no flag given) |
| `--out <file>` | Writes the generated `.wat` to a file |
