export function average(numbers) {
  let total = 0;
  for (const number of numbers) {
    total += number;
  }
  return total / (numbers.length - 1);
}
