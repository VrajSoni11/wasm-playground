// Translates a type-checked AST into WebAssembly Text format (WAT).
// Design:
//  - int -> i32, float -> f32, bool -> i32 (0/1)
//  - every function's params + local `let`s become WASM locals, referenced
//    by name (WAT lets you use $names instead of raw indices, which keeps
//    the emitted text readable for grading/demo purposes)
//  - `print(expr)` calls an imported host function chosen by the runtime
//    type of expr: env.print_i32 / env.print_f32 / env.print_bool
//  - control flow uses WASM's structured instructions:
//      if      -> (if (then ...) (else ...))
//      while   -> (block $exit (loop $top
//                    <condition, negated, br_if $exit>
//                    <body>
//                    br $top
//                  ))

function wasmType(langType) {
  if (langType === "int") return "i32";
  if (langType === "float") return "f32";
  if (langType === "bool") return "i32";
  throw new Error(`No WASM type mapping for '${langType}'`);
}

class CodeGen {
  constructor(functionTable) {
    this.functionTable = functionTable; // name -> { paramTypes, returnType }
    this.labelCounter = 0; // for unique while-loop labels
  }

  // Public entry point. `program` must already be analyzed (resolvedType
  // fields present). Returns a full WAT module as a string.
  generate(program) {
    const funcDecls = program.declarations.filter((d) => d.type === "FuncDecl");
    const globalVarDecls = program.declarations.filter((d) => d.type === "VarDecl");
    const topLevelStmts = program.declarations.filter(
      (d) => d.type !== "FuncDecl" && d.type !== "VarDecl"
    );

    const lines = [];
    lines.push("(module");
    lines.push(`  (import "env" "print_i32" (func $print_i32 (param i32)))`);
    lines.push(`  (import "env" "print_f32" (func $print_f32 (param f32)))`);
    lines.push(`  (import "env" "print_bool" (func $print_bool (param i32)))`);
    lines.push("");

    // User functions
    for (const fn of funcDecls) {
      lines.push(this.genFunction(fn));
      lines.push("");
    }

    // Top-level code (global var decls + top-level statements like the
    // final `print(...)`) is wrapped into a synthetic "main" function that
    // we export and the runtime calls after instantiation.
    lines.push(this.genMain(globalVarDecls, topLevelStmts));

    // Export user functions too, so the playground can call them directly
    // (e.g. to try `fib(12)` interactively without re-running main).
    for (const fn of funcDecls) {
      lines.push(`  (export "${fn.name}" (func $${fn.name}))`);
    }
    lines.push(`  (export "main" (func $main))`);

    lines.push(")");
    return lines.join("\n");
  }

  // ---------------- functions ----------------
  genFunction(fn) {
    const locals = new Map(); // name -> wasmType
    for (const p of fn.params) locals.set(p.name, wasmType(p.paramType));
    this.collectLocals(fn.body, locals);

    const paramStr = fn.params.map((p) => `(param $${p.name} ${wasmType(p.paramType)})`).join(" ");
    const resultStr = fn.returnType ? ` (result ${wasmType(fn.returnType)})` : "";

    // Emit (local ...) decls for every local that isn't a param
    const localDecls = [];
    for (const [name, wtype] of locals) {
      if (!fn.params.some((p) => p.name === name)) {
        localDecls.push(`(local $${name} ${wtype})`);
      }
    }

    const ctx = { locals, returnType: fn.returnType };
    const body = fn.body.statements.map((s) => this.genStatement(s, ctx, 2)).join("\n");

    const header = `  (func $${fn.name} ${paramStr}${resultStr}`;
    const localLine = localDecls.length ? `\n    ${localDecls.join(" ")}` : "";

    // If the function returns a value, every reachable path is required
    // (by our semantic analyzer, in principle) to hit an explicit `return`.
    // WASM's validator, however, still checks the *fallthrough* type at the
    // end of the function body, which our nested if/else blocks don't
    // contribute a value to (each branch exits via `return` instead).
    // `unreachable` tells the validator "control never actually reaches
    // here", satisfying the stack-type check without full reachability
    // analysis on our end.
    const trailer = fn.returnType ? `\n    unreachable` : "";

    return `${header}${localLine}\n${body}${trailer}\n  )`;
  }

  // Synthetic main(): runs global var decls then top-level statements.
  genMain(globalVarDecls, topLevelStmts) {
    const locals = new Map();
    for (const d of globalVarDecls) locals.set(d.name, wasmType(d.resolvedType));

    const ctx = { locals, returnType: null };
    const localDecls = [...locals].map(([name, wtype]) => `(local $${name} ${wtype})`);
    const localLine = localDecls.length ? `\n    ${localDecls.join(" ")}` : "";

    const body = [
      ...globalVarDecls.map((d) => this.genStatement(d, ctx, 2)),
      ...topLevelStmts.map((s) => this.genStatement(s, ctx, 2)),
    ].join("\n");

    return `  (func $main${localLine}\n${body}\n  )`;
  }

  // Walk a block recursively collecting every VarDecl's local slot.
  // (WASM requires all locals declared once at function top, even though
  // our source language allows `let` anywhere in nested blocks.)
  collectLocals(block, locals) {
    for (const stmt of block.statements) {
      if (stmt.type === "VarDecl") {
        locals.set(stmt.name, wasmType(stmt.resolvedType));
      } else if (stmt.type === "IfStmt") {
        this.collectLocals(stmt.thenBranch, locals);
        if (stmt.elseBranch) {
          if (stmt.elseBranch.type === "IfStmt") {
            this.collectLocalsFromIf(stmt.elseBranch, locals);
          } else {
            this.collectLocals(stmt.elseBranch, locals);
          }
        }
      } else if (stmt.type === "WhileStmt") {
        this.collectLocals(stmt.body, locals);
      } else if (stmt.type === "Block") {
        this.collectLocals(stmt, locals);
      }
    }
  }

  collectLocalsFromIf(ifStmt, locals) {
    this.collectLocals(ifStmt.thenBranch, locals);
    if (ifStmt.elseBranch) {
      if (ifStmt.elseBranch.type === "IfStmt") {
        this.collectLocalsFromIf(ifStmt.elseBranch, locals);
      } else {
        this.collectLocals(ifStmt.elseBranch, locals);
      }
    }
  }

  // ---------------- statements ----------------
  genStatement(stmt, ctx, indent) {
    const pad = "  ".repeat(indent);
    switch (stmt.type) {
      case "VarDecl": {
        const valueCode = this.genExpr(stmt.initializer, ctx);
        return `${pad}${valueCode}\n${pad}(local.set $${stmt.name})`;
      }

      case "ExprStmt": {
        const expr = stmt.expression;
        const code = this.genExpr(expr, ctx);
        // Assign already ends with local.set (produces no value on stack).
        // A call to a void function also leaves nothing on the stack.
        // Everything else (e.g. a bare arithmetic expression) leaves one
        // value that must be dropped to keep the stack balanced.
        if (expr.type === "Assign") return code;
        if (expr.type === "Call" && expr.resolvedType === "void") return code;
        return `${code}\n${pad}drop`;
      }

      case "PrintStmt": {
        const t = stmt.expression.resolvedType;
        const printFn = t === "float" ? "$print_f32" : t === "bool" ? "$print_bool" : "$print_i32";
        const code = this.genExpr(stmt.expression, ctx);
        return `${code}\n${pad}(call ${printFn})`;
      }

      case "IfStmt": {
        const condCode = this.genExpr(stmt.condition, ctx);
        const thenCode = stmt.thenBranch.statements
          .map((s) => this.genStatement(s, ctx, indent + 2))
          .join("\n");
        let out = `${condCode}\n${pad}(if\n${pad}  (then\n${thenCode}\n${pad}  )`;
        if (stmt.elseBranch) {
          const elseStmts =
            stmt.elseBranch.type === "IfStmt" ? [stmt.elseBranch] : stmt.elseBranch.statements;
          const elseCode = elseStmts.map((s) => this.genStatement(s, ctx, indent + 2)).join("\n");
          out += `\n${pad}  (else\n${elseCode}\n${pad}  )`;
        }
        out += `\n${pad})`;
        return out;
      }

      case "WhileStmt": {
        const id = this.labelCounter++;
        const exitLabel = `$exit_${id}`;
        const topLabel = `$loop_${id}`;
        const condCode = this.genExpr(stmt.condition, ctx);
        const bodyCode = stmt.body.statements
          .map((s) => this.genStatement(s, ctx, indent + 2))
          .join("\n");
        return (
          `${pad}(block ${exitLabel}\n` +
          `${pad}  (loop ${topLabel}\n` +
          `${condCode}\n` +
          `${pad}    i32.eqz\n` +
          `${pad}    (br_if ${exitLabel})\n` +
          `${bodyCode}\n` +
          `${pad}    (br ${topLabel})\n` +
          `${pad}  )\n` +
          `${pad})`
        );
      }

      case "ReturnStmt": {
        if (stmt.value === null) return `${pad}return`;
        const code = this.genExpr(stmt.value, ctx);
        return `${code}\n${pad}return`;
      }

      case "Block":
        return stmt.statements.map((s) => this.genStatement(s, ctx, indent)).join("\n");

      default:
        throw new Error(`Codegen: unknown statement type '${stmt.type}'`);
    }
  }

  // ---------------- expressions ----------------
  // Stack-machine style: every expr pushes exactly one value.
  genExpr(expr, ctx) {
    switch (expr.type) {
      case "NumberLit":
        return expr.isFloat ? `(f32.const ${expr.value})` : `(i32.const ${expr.value})`;

      case "BoolLit":
        return `(i32.const ${expr.value ? 1 : 0})`;

      case "Variable":
        return `(local.get $${expr.name})`;

      case "Assign": {
        const valueCode = this.genExpr(expr.value, ctx);
        return `${valueCode}\n    (local.set $${expr.name})`;
      }

      case "Unary": {
        const operandCode = this.genExpr(expr.operand, ctx);
        if (expr.op === "-") {
          const wtype = wasmType(expr.resolvedType);
          if (wtype === "i32") return `(i32.sub (i32.const 0) ${operandCode})`;
          return `(f32.neg ${operandCode})`;
        }
        if (expr.op === "!") {
          return `(i32.eqz ${operandCode})`;
        }
        throw new Error(`Codegen: unknown unary op '${expr.op}'`);
      }

      case "Binary": {
        const leftCode = this.genExpr(expr.left, ctx);
        const rightCode = this.genExpr(expr.right, ctx);
        const wtype = wasmType(expr.left.resolvedType);
        const instr = this.binaryInstr(expr.op, wtype);
        return `(${instr} ${leftCode} ${rightCode})`;
      }

      case "Logical": {
        // Both operands are bool (i32 0/1); && and || map straight to
        // i32 bitwise and/or since 0/1 booleans behave correctly under them.
        const leftCode = this.genExpr(expr.left, ctx);
        const rightCode = this.genExpr(expr.right, ctx);
        const instr = expr.op === "&&" ? "i32.and" : "i32.or";
        return `(${instr} ${leftCode} ${rightCode})`;
      }

      case "Call": {
        const argsCode = expr.args.map((a) => this.genExpr(a, ctx)).join(" ");
        return `(call $${expr.callee} ${argsCode})`;
      }

      default:
        throw new Error(`Codegen: unknown expression type '${expr.type}'`);
    }
  }

  binaryInstr(op, wtype) {
    // wtype is 'i32' or 'f32'. Comparisons on i32 are signed (matches our
    // 'int' semantics); f32 comparisons don't need a sign variant.
    const table = {
      i32: {
        "+": "i32.add", "-": "i32.sub", "*": "i32.mul", "/": "i32.div_s",
        "<": "i32.lt_s", ">": "i32.gt_s", "<=": "i32.le_s", ">=": "i32.ge_s",
        "==": "i32.eq", "!=": "i32.ne",
      },
      f32: {
        "+": "f32.add", "-": "f32.sub", "*": "f32.mul", "/": "f32.div",
        "<": "f32.lt", ">": "f32.gt", "<=": "f32.le", ">=": "f32.ge",
        "==": "f32.eq", "!=": "f32.ne",
      },
    };
    const instr = table[wtype]?.[op];
    if (!instr) throw new Error(`Codegen: no instruction for '${op}' on '${wtype}'`);
    return instr;
  }
}

module.exports = { CodeGen, wasmType };
