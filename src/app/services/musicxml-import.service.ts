import { Injectable } from '@angular/core';
import { MidiAnalysis } from '../../core/midi';
import { parseMusicXmlFile } from '../../core/musicxml';

@Injectable({ providedIn: 'root' })
export class MusicXmlImportService {
  analyze(buffer: ArrayBuffer, fileName: string): MidiAnalysis {
    return parseMusicXmlFile(buffer, fileName);
  }
}
