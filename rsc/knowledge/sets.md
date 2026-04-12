# Python Sets — Knowledge Base
Source: W3Schools Python Tutorial (https://www.w3schools.com/python/python_sets.asp)

## What is a Set?
A set is a collection which is **unordered**, **unchangeable***, and **unindexed**.
*Set items themselves are unchangeable, but you can add and remove items.

Sets are written with curly brackets and do **not allow duplicate values**.

```python
myset = {"apple", "banana", "cherry"}
```

## Key Properties
| Property     | Meaning |
|--------------|---------|
| Unordered    | Items have no defined order; cannot be accessed by index |
| Unchangeable | Existing items cannot be modified after creation |
| No duplicates| Each value must be unique |

## Duplicate Behaviour
Duplicate values are silently ignored:
```python
thisset = {"apple", "banana", "cherry", "apple"}
# Result: {'apple', 'banana', 'cherry'}
```

`True` and `1` are treated as duplicates. `False` and `0` are treated as duplicates:
```python
thisset = {"apple", "banana", True, 1, 2}
# 1 is dropped because True == 1
```

## Creating a Set
```python
# Literal syntax
fruits = {"apple", "banana", "cherry"}

# set() constructor (note double parentheses)
fruits = set(("apple", "banana", "cherry"))
```

## Set Length
```python
thisset = {"apple", "banana", "cherry"}
print(len(thisset))  # 3
```

## Common Set Methods
| Method | Shortcut | Description |
|--------|----------|-------------|
| `add(x)` | — | Add item x to the set |
| `remove(x)` | — | Remove x; raises KeyError if not found |
| `discard(x)` | — | Remove x; no error if not found |
| `pop()` | — | Remove and return a random item |
| `clear()` | — | Remove all items |
| `union(s)` | `\|` | Return set of all items from both sets |
| `intersection(s)` | `&` | Return items present in both sets |
| `difference(s)` | `-` | Return items in this set but not in s |
| `issubset(s)` | `<=` | True if all items of this set are in s |
| `issuperset(s)` | `>=` | True if this set contains all items of s |
| `isdisjoint(s)` | — | True if the two sets have no items in common |
| `update(s)` | `\|=` | Add all items from s into this set |

## Set Operations Examples
```python
a = {1, 2, 3, 4}
b = {3, 4, 5, 6}

print(a | b)   # union:        {1, 2, 3, 4, 5, 6}
print(a & b)   # intersection: {3, 4}
print(a - b)   # difference:   {1, 2}
print(a ^ b)   # symmetric difference: {1, 2, 5, 6}
```

## Looping a Set
```python
for x in {"apple", "banana", "cherry"}:
    print(x)
```

## Frozenset
An immutable version of a set — cannot add or remove items:
```python
frozen = frozenset({"apple", "banana", "cherry"})
```

## Comparison with Other Collections
| Type       | Ordered | Changeable | Duplicates |
|------------|---------|------------|------------|
| List       | Yes     | Yes        | Yes        |
| Tuple      | Yes     | No         | Yes        |
| Set        | No      | No*        | No         |
| Dictionary | Yes     | Yes        | No (keys)  |
