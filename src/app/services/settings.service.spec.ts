import { beforeEach, describe, expect, it } from 'vitest';
import { NOTE_COLORS } from '../../core/kalimba';
import { SettingsService } from './settings.service';

describe('SettingsService', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('parte de los colores por defecto y normaliza colores inválidos', () => {
    const service = new SettingsService();

    expect(service.settings().noteColors).toEqual([...NOTE_COLORS]);
    expect(service.settings().tineColors).toEqual({});

    service.update({
      noteColors: [
        '#112233',
        '#445566',
        '#778899',
        '#aabbcc',
        '#ddeeff',
        '#010203',
        'no-es-un-color',
      ],
    });

    expect(service.settings().noteColors).toEqual([
      '#112233',
      '#445566',
      '#778899',
      '#aabbcc',
      '#ddeeff',
      '#010203',
      NOTE_COLORS[6],
    ]);
  });

  it('guarda colores por tina y permite repetir el mismo color', () => {
    const service = new SettingsService();
    service.update({
      tineColors: {
        '1': '#112233',
        "1'": '#112233',
        '2': 'no-es-un-color',
      },
    });

    expect(service.settings().tineColors).toEqual({
      '1': '#112233',
      "1'": '#112233',
    });
    expect(new SettingsService().settings().tineColors).toEqual({
      '1': '#112233',
      "1'": '#112233',
    });
  });

  it('persiste los colores de notas', () => {
    const service = new SettingsService();
    const colors = ['#111111', '#222222', '#333333', '#444444', '#555555', '#666666', '#777777'];
    service.update({ noteColors: colors });

    expect(new SettingsService().settings().noteColors).toEqual(colors);
  });
});
