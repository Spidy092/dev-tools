export function average(numbers) {
  if (numbers.length === 0) {
    throw new Error("Cannot average an empty array");
  }

  let total = 0;
  for (const number of numbers) {
    total += number;
  }

  return total / numbers.length;
}
