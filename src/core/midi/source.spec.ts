import { decodeMidiSource, encodeMidiSource } from './source';

describe('midi source', () => {
  it('round-trips binary data', () => {
    const source = new Uint8Array([0, 1, 2, 127, 128, 255]);
    const encoded = encodeMidiSource(source.buffer);

    expect(decodeMidiSource(encoded)).toEqual(source.buffer);
  });
});
