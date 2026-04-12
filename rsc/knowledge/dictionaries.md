# Python Dictionaries — Knowledge Base
Source: W3Schools Python Tutorial (https://www.w3schools.com/python/python_dictionaries.asp)

## What is a Dictionary?
A dictionary stores data in **key:value pairs**. It is **ordered*** (Python 3.7+), **changeable**, and does **not allow duplicate keys**.

*As of Python 3.7 dictionaries maintain insertion order. In Python 3.6 and earlier they were unordered.

```python
thisdict = {
  "brand": "Ford",
  "model": "Mustang",
  "year": 1964
}
```

## Key Properties
| Property   | Meaning |
|------------|---------|
| Ordered    | Items keep insertion order (Python 3.7+) |
| Changeable | Items can be added, changed, removed |
| No duplicate keys | A key can appear only once; later value overwrites earlier |

## Accessing Values
```python
# By key (raises KeyError if missing)
print(thisdict["brand"])       # "Ford"

# With .get() (returns None or default if missing — safe)
print(thisdict.get("brand"))   # "Ford"
print(thisdict.get("color", "unknown"))  # "unknown"
```

## Modifying a Dictionary
```python
# Change value
thisdict["year"] = 2020

# Add new key
thisdict["color"] = "red"

# Delete key
del thisdict["model"]
thisdict.pop("model")          # also works, returns removed value

# Remove last inserted item
thisdict.popitem()

# Clear all items
thisdict.clear()
```

## Iterating
```python
d = {"name": "Alice", "age": 25}

for key in d:              # iterate keys
    print(key)

for val in d.values():     # iterate values
    print(val)

for k, v in d.items():     # iterate key-value pairs
    print(k, v)
```

## Useful Dictionary Methods
| Method | Description |
|--------|-------------|
| `keys()` | Returns a view of all keys |
| `values()` | Returns a view of all values |
| `items()` | Returns a view of all (key, value) tuples |
| `get(k, default)` | Return value for k; default if missing |
| `pop(k)` | Remove and return value for k |
| `popitem()` | Remove and return the last inserted pair |
| `update(d2)` | Merge d2 into this dict (overwrites existing keys) |
| `setdefault(k, v)` | Insert k with value v if k not present; return its value |
| `copy()` | Shallow copy |
| `clear()` | Remove all items |
| `fromkeys(seq, val)` | New dict from sequence of keys, all set to val |

## Creating a Dictionary
```python
# Literal
person = {"name": "Alice", "age": 25}

# dict() constructor
person = dict(name="Alice", age=25)

# fromkeys — initialise keys with a default value
keys = ["a", "b", "c"]
defaults = dict.fromkeys(keys, 0)  # {'a': 0, 'b': 0, 'c': 0}
```

## Nested Dictionaries
```python
family = {
  "child1": {"name": "Alice", "age": 10},
  "child2": {"name": "Bob",   "age": 8},
}
print(family["child1"]["name"])  # "Alice"
```

## Dictionary Comprehension
```python
squares = {x: x**2 for x in range(1, 6)}
# {1: 1, 2: 4, 3: 9, 4: 16, 5: 25}
```

## Checking Key Existence
```python
if "brand" in thisdict:
    print("brand exists")
```
