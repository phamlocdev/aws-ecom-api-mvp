function isSameValue(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true
  }

  if (Number.isNaN(left) && Number.isNaN(right)) {
    return true
  }

  if (typeof left !== 'object' || left === null || typeof right !== 'object' || right === null) {
    return false
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false
    }

    for (let index = 0; index < left.length; index += 1) {
      if (!isSameValue(left[index], right[index])) {
        return false
      }
    }

    return true
  }

  const leftObject = left as Record<string, unknown>
  const rightObject = right as Record<string, unknown>
  const leftKeys = Object.keys(leftObject)

  if (leftKeys.length !== Object.keys(rightObject).length) {
    return false
  }

  for (const key of leftKeys) {
    if (
      !Object.prototype.hasOwnProperty.call(rightObject, key) ||
      !isSameValue(leftObject[key], rightObject[key])
    ) {
      return false
    }
  }

  return true
}

;(() => {
  console.log(isSameValue({ a: 1, b: 1 }, { b: 1, a: 1 }))
})()
