'use strict';
/*
 * config/branding.js — TOGGLE anonimisasi brand bandar (Fase 4, audit 3c).
 * -----------------------------------------------------------------------
 * Mode PRIBADI (default): tampilkan nama asli (SBOBET / Bet365) — jelas & jujur.
 * Mode JUAL (ANONIM=true): "Bandar Acuan" / "Bandar Pembanding" — hindari risiko
 * merek dagang pihak ketiga di produk berbayar (AUDIT-KOMERSIAL.md §3c).
 *
 * CATATAN: ini murni LABEL TAMPILAN. Nama bookmaker untuk API odds-api.io
 * ('Sbobet','Bet365' di engine.normalizeOddsApiIo / URL fetch) TIDAK berubah —
 * itu identifier teknis upstream, bukan branding.
 */
const ANONIM = false;   // ← mode jual: ubah ke true

const LABELS = ANONIM
  ? { sharp: 'Bandar Acuan', pub: 'Bandar Pembanding' }
  : { sharp: 'SBOBET', pub: 'Bet365' };

module.exports = {
  ANONIM,
  LABELS,
  reference: LABELS.sharp,
  compare: LABELS.pub + ' (publik)',
};
