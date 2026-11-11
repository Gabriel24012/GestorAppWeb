import { describe, expect, it } from 'vitest';
import { recordSchema, toIsoDate } from './validation.js';

const valid = {
  capture_session_id: '00000000-0000-4000-8000-000000000001',
  first_name: 'Ana',
  paternal_surname: 'Lopez',
  address: 'Calle Uno',
  birth_date: '15/07/1990',
  phone: '5512345678',
  electoral_key: 'ABCDEF12345678H001'
};

describe('recordSchema', () => {
  it('acepta datos validos y normaliza clave', () => {
    expect(recordSchema.parse({ ...valid, electoral_key: valid.electoral_key.toLowerCase() }).electoral_key).toBe(valid.electoral_key);
  });

  it('acepta fecha seleccionada desde calendario', () => {
    expect(toIsoDate(recordSchema.parse({ ...valid, birth_date: '1990-07-15' }).birth_date)).toBe('1990-07-15');
  });

  it('rechaza fecha de nacimiento futura', () => {
    expect(() => recordSchema.parse({ ...valid, birth_date: '2100-01-01' })).toThrow();
  });

  it('rechaza edad mayor a 120 anos', () => {
    expect(() => recordSchema.parse({ ...valid, birth_date: '1800-01-01' })).toThrow();
  });

  it('rechaza telefono invalido', () => {
    expect(() => recordSchema.parse({ ...valid, phone: '123' })).toThrow();
  });
});
