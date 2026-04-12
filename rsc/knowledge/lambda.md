# Python Lambda (Anonymous Functions) — Knowledge Base
Source: W3Schools Python Tutorial (https://www.w3schools.com/python/python_lambda.asp)

## What is a Lambda Function?
A lambda function is a **small, anonymous (unnamed) function** defined with the `lambda` keyword.
It can take **any number of arguments** but can only contain **one expression**.
The expression is evaluated and the result is automatically returned.

## Syntax
```
lambda arguments : expression
```

## Basic Examples
```python
# Single argument
square = lambda x: x ** 2
print(square(5))   # 25

# Multiple arguments
add = lambda a, b: a + b
print(add(3, 4))   # 7

# Three arguments
total = lambda a, b, c: a + b + c
print(total(1, 2, 3))  # 6
```

## Lambda vs def
```python
# Regular function
def add(a, b):
    return a + b

# Equivalent lambda
add = lambda a, b: a + b
```
A lambda is essentially a one-line anonymous function. Use `def` when you need multiple statements, docstrings, or a named reusable function.

## Why Use Lambda?
The main use case is passing a short function **inline** — especially as an argument to higher-order functions like `map()`, `filter()`, and `sorted()`.

## Lambda Inside a Function (Closure Pattern)
```python
def multiplier(n):
    return lambda x: x * n

double = multiplier(2)
triple = multiplier(3)

print(double(5))   # 10
print(triple(5))   # 15
```

## Lambda with map()
`map(function, iterable)` — applies function to every item:
```python
numbers = [1, 2, 3, 4, 5]
doubled = list(map(lambda x: x * 2, numbers))
print(doubled)   # [2, 4, 6, 8, 10]
```

## Lambda with filter()
`filter(function, iterable)` — keeps items where function returns True:
```python
numbers = [1, 2, 3, 4, 5, 6, 7, 8]
evens = list(filter(lambda x: x % 2 == 0, numbers))
print(evens)   # [2, 4, 6, 8]
```

## Lambda with sorted()
Use a lambda as the `key` argument to customise sort order:
```python
# Sort list of tuples by second element (age)
students = [("Emil", 25), ("Tobias", 22), ("Linus", 28)]
by_age = sorted(students, key=lambda s: s[1])
print(by_age)   # [('Tobias', 22), ('Emil', 25), ('Linus', 28)]

# Sort strings by length
words = ["apple", "pie", "banana"]
by_len = sorted(words, key=lambda w: len(w))
print(by_len)   # ['pie', 'apple', 'banana']
```

## Key Rules & Limitations
| Rule | Detail |
|------|--------|
| One expression only | Cannot use `if/else` blocks, loops, or multiple statements |
| Auto-return | The expression result is returned automatically — no `return` keyword |
| Can be assigned | `f = lambda x: x+1` is valid but `def f` is preferred for clarity |
| Inline use preferred | Best used directly as a function argument, not stored in a variable |

## Ternary (conditional) expression in Lambda
A lambda *can* include a conditional expression (ternary, not a block `if`):
```python
classify = lambda x: "even" if x % 2 == 0 else "odd"
print(classify(4))   # "even"
```
