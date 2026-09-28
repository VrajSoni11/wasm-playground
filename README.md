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

### Example program

```c
fn fib(n: int) -> int {
  if (n <= 1) {
    return n;
  } else {
    return fib(n - 1) + fib(n - 2);
  }
}

let result = fib(10);
print(result);
```

More examples are in [`examples/`](examples/):
- `fibonacci.src` — recursion
- `factorial.src` — while loops
- `gcd.src` — Euclidean algorithm (while loop + arithmetic)
- `mixed.src` — booleans, floats, nested conditionals together

---

## Setup

Requires **Node.js** (v18+ recommended).

```bash
npm install
```

That's it — the only dependency is `wabt`, used purely for the final
WAT-text → WASM-binary assembly step.

---

## Usage

### 1. Run the test suite

```bash
npm test
```

This runs 56 tests across all four compiler phases, including full
end-to-end tests that compile source code all the way to a running WASM
binary and check its output (e.g. verifying `fib(10) === 55`).

### 2. Compile and run a program (CLI)

```bash
node compile.js examples/fibonacci.src --run
```

```
✓ Semantic analysis passed (no type errors)

=== PROGRAM OUTPUT ===
55
610
=== END OUTPUT ===
```

### 3. Inspect intermediate compiler output

Every phase's output can be dumped for demonstration purposes:

```bash
node compile.js examples/fibonacci.src --tokens --ast --wat --run
```

| Flag | Shows |
|---|---|
| `--tokens` | The token stream from the lexer |
| `--ast` | The parsed AST as JSON |
| `--wat` | The generated WebAssembly Text |
| `--run` | Assembles to WASM and executes it (default if no flag given) |
| `--out <file>` | Writes the generated `.wat` to a file |

Compile errors are reported per-phase with line numbers:

```bash
$ echo 'let x = 1 + true;' > bad.src
$ node compile.js bad.src

✗ Semantic analysis failed
  Semantic error [line 1]: Operator '+' requires matching types, got 'int' and 'bool'
```

### 4. Browser playground

A zero-build-tool, single-page playground: a source editor, a "Compile & Run"
button, and tabs showing the tokens / AST / WAT / program output for
whatever you type.

```bash
open playground/playground.html
```

(or just double-click the file / drag it into a browser tab — it needs no
server, since it loads the compiler and `wabt` as plain `<script>` tags.)

The playground runs the **exact same compiler source** as the CLI — see
"How the playground works" below.

---

## Project structure

```
wasm-compiler/
├── src/
│   ├── tokens.js       # Token types, keyword table
│   ├── lexer.js        # Phase 1: Lexer
│   ├── ast.js           # AST node definitions
│   ├── parser.js        # Phase 2: Recursive-descent parser
│   ├── scope.js          # Symbol table / scope chain
│   ├── analyzer.js         # Phase 3: Semantic analysis & type checking
│   └── codegen.js           # Phase 4: AST -> WAT codegen
├── test/
│   ├── lexer.test.js
│   ├── parser.test.js
│   ├── analyzer.test.js
│   ├── codegen.test.js
│   └── e2e.test.js        # Full pipeline: source -> WASM -> execution
├── examples/
│   ├── fibonacci.src
│   ├── factorial.src
│   ├── gcd.src
│   └── mixed.src
├── playground/
│   ├── playground.html    # The browser UI
│   └── compiler.bundle.js # Auto-generated bundle of src/*.js (see below)
├── compile.js            # CLI driver
├── build-playground.js   # Bundles src/*.js for the browser (regenerate after editing src/)
├── package.json
└── README.md
```

## How the playground works

Browsers can't `require()` Node-style CommonJS modules directly, so
`build-playground.js` is a small (~40-line) hand-written bundler: it wraps
each file in `src/` in a module closure and concatenates them into
`playground/compiler.bundle.js`, which `playground.html` loads as a plain
`<script>` tag alongside `wabt`'s browser build (loaded from a CDN).

**If you edit anything in `src/`, re-run the bundler before re-opening the
playground:**

```bash
npm run build:playground
```

This keeps the playground and the CLI running identical compiler logic —
there is exactly one implementation of the lexer/parser/analyzer/codegen,
not a separate browser copy.

---

## Design notes (for the project report)

- **Grammar:** a full EBNF grammar for the source language is implemented
  directly by the recursive-descent parser — each grammar production is one
  parser method (`expression()`, `term()`, `factor()`, `unary()`, etc.),
  following standard precedence-climbing for arithmetic and logical operators.
- **AST representation:** plain JSON-serializable objects rather than
  classes, so the whole tree can be dumped with `JSON.stringify` for
  debugging or visualization (used directly by the `--ast` CLI flag and the
  playground's AST tab).
- **Type system:** `int → i32`, `float → f32`, `bool → i32` (0/1). Booleans
  are tracked as a distinct type during semantic analysis (so `1 + true` is
  correctly rejected) even though they're unified to `i32` at the WASM level.
- **Scoping:** a chained `Scope` (symbol table) per block; `let` inside an
  `if`/`while` body is only visible inside that block, and shadowing an
  outer variable is allowed.
- **Two-pass semantic analysis:** function signatures are registered in a
  first pass before checking any function body, so forward references,
  recursion, and mutual recursion between functions all work regardless of
  declaration order.
- **Return-path checking:** a function declared with a return type must
  provably return on every code path (checked recursively through
  `if`/`else` chains); this is enforced at the semantic-analysis stage so a
  buggy program is rejected with a clear error rather than trapping at
  runtime.
- **Codegen — control flow:** WASM has *structured* control flow rather than
  arbitrary jumps. `if`/`else` maps directly onto WASM's `(if (then ...)
  (else ...))`. `while` is compiled into a `block` wrapping a `loop`, with
  the (negated) condition as a conditional branch out of the block:
  ```wat
  (block $exit
    (loop $top
      <condition>
      i32.eqz
      (br_if $exit)
      <body>
      (br $top)
    )
  )
  ```
- **Codegen — locals:** WASM requires all local variables to be declared
  once at the top of a function, even though the source language allows
  `let` anywhere inside nested blocks. The code generator does a small
  pre-pass (`collectLocals`) that walks the whole function body, including
  inside `if`/`while` blocks, to gather every local before emitting the
  function.
- **`print` as an imported function:** WebAssembly has no I/O of its own, so
  `print(x)` compiles to a call to one of three *imported* host functions
  (`env.print_i32`, `env.print_f32`, `env.print_bool`, chosen by the
  static type of `x`), which the runtime environment (the CLI or the
  playground) supplies when instantiating the module.

## Known limitations / possible future work

- No implicit numeric coercion between `int` and `float` (e.g. `1 + 2.0` is
  a type error, not automatically promoted) — a deliberate simplification.
- No arrays, strings, or structs — the language is intentionally kept small.
- No dead-code elimination or other optimization passes; the code generator
  does a direct, unoptimized AST-to-instruction translation.
- Error recovery in the parser stops at the first error rather than
  attempting to continue and report multiple errors.

These would be natural "future work" points to mention if asked in a viva
or project defense.
