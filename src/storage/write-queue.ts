class SerialWriteQueue {
  private pending: Promise<void> = Promise.resolve();

  async runExclusive<T>(task: () => Promise<T>): Promise<T> {
    const previous = this.pending;
    let release!: () => void;
    this.pending = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;
    try {
      return await task();
    } finally {
      release();
    }
  }
}

export const storageWriteQueue = new SerialWriteQueue();

