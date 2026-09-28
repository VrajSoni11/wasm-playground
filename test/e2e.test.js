const { Lexer } = require("../src/lexer");
const { Parser } = require("../src/parser");
const { Analyzer } = require("../src/analyzer");
const { CodeGen } = require("../src/codegen");
const wabtModule = require("wabt");

async function compileAndRun(source) {
  const tokens = new Lexer(source).scanTokens();
  const ast = new Parser(tokens).parse();
  const functionTable = new Analyzer().analyze(ast);
  const wat = new CodeGen(functionTable).generate(ast);

  const wabt = await wabtModule();
  const wasmModule = wabt.parseWat("generated.wat", wat);
  const { buffer } = wasmModule.toBinary({});

  const printed = [];
  const importObject = {
    env: {
      print_i32: (v) => printed.push(v),
      print_f32: (v) => printed.push(Math.fround(v)),
      print_bool: (v) => printed.push(Boolean(v)),
    },
  };

  const { instance } = await WebAssembly.instantiate(buffer, importObject);
  instance.exports.main(); // run top-level statements
  return { instance, printed, wat };
}

function run(name, fn) {
  return fn()
    .then(() => console.log(`PASS: ${name}`))
    .catch((e) => {
      console.log(`FAIL: ${name}`);
      console.log(`  ${e.stack || e.message}`);
    });
}

function assertEqual(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg || ""}\n  expected: ${e}\n  actual:   ${a}`);
}

async function main() {
  await run("runs recursive fibonacci and prints correct result", async () => {
    const { printed } = await compileAndRun(`
      fn fib(n: int) -> int {
        if (n <= 1) { return n; }
        return fib(n - 1) + fib(n - 2);
      }
      print(fib(10));
    `);
    assertEqual(printed, [55]); // fib(10) = 55
  });

  await run("computes factorial via while loop", async () => {
    const { printed } = await compileAndRun(`
      fn factorial(n: int) -> int {
        let result = 1;
        let i = 1;
        while (i <= n) {
          result = result * i;
          i = i + 1;
        }
        return result;
      }
      print(factorial(6));
    `);
    assertEqual(printed, [720]); // 6! = 720
  });

  await run("exported function is directly callable from JS", async () => {
    const { instance } = await compileAndRun(`
      fn square(x: int) -> int { return x * x; }
    `);
    assertEqual(instance.exports.square(7), 49);
    assertEqual(instance.exports.square(12), 144);
  });

  await run("handles float arithmetic correctly", async () => {
    const { printed } = await compileAndRun(`
      fn area(r: float) -> float { return r * r * 3.14; }
      print(area(2.0));
    `);
    // 2.0 * 2.0 * 3.14 = 12.56, but f32 rounding may apply
    if (Math.abs(printed[0] - 12.56) > 0.001) {
      throw new Error(`expected ~12.56, got ${printed[0]}`);
    }
  });

  await run("handles bool logic and comparisons", async () => {
    const { printed } = await compileAndRun(`
      fn isPositive(n: int) -> bool { return n > 0; }
      print(isPositive(5));
      print(isPositive(-3));
    `);
    assertEqual(printed, [true, false]);
  });

  await run("handles nested if/else branches correctly", async () => {
    const { printed } = await compileAndRun(`
      fn classify(n: int) -> int {
        if (n < 0) { return -1; }
        else if (n == 0) { return 0; }
        else { return 1; }
      }
      print(classify(-5));
      print(classify(0));
      print(classify(5));
    `);
    assertEqual(printed, [-1, 0, 1]);
  });

  await run("handles multiple print statements and mixed types", async () => {
    const { printed } = await compileAndRun(`
      print(42);
      print(3.5);
      print(true);
      print(false);
    `);
    assertEqual(printed, [42, 3.5, true, false]);
  });

  await run("gcd via while loop and recursion-free logic", async () => {
    const { printed } = await compileAndRun(`
      fn gcd(a: int, b: int) -> int {
        while (b != 0) {
          let t = b;
          b = a - (a / b) * b;
          a = t;
        }
        return a;
      }
      print(gcd(48, 18));
    `);
    assertEqual(printed, [6]); // gcd(48, 18) = 6
  });

  await run("logical && and || operators work correctly", async () => {
    const { printed } = await compileAndRun(`
      fn f(a: bool, b: bool) {
        print(a && b);
        print(a || b);
      }
      f(true, false);
    `);
    assertEqual(printed, [false, true]); // true && false = false, true || false = true
  });

  await run("unary negation and not work correctly", async () => {
    const { printed } = await compileAndRun(`
      let x = -5;
      print(x);
      let flag = !false;
      print(flag);
    `);
    assertEqual(printed, [-5, true]);
  });

  console.log("\nAll end-to-end pipeline tests complete.");
}

main();
