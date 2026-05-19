export type Listener<T> = (value: T) => void;

export class Observable<T> {
  private listeners = new Set<Listener<T>>();

  constructor(private value: T) {}

  get(): T {
    return this.value;
  }

  set(value: T): void {
    this.value = value;
    this.listeners.forEach((l) => l(value));
  }

  subscribe(listener: Listener<T>): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
