/* SPDX-License-Identifier: AGPL-3.0-only */

/* Welcher eigene Schnellaktions-Knopf gerade im Bearbeitungsblatt liegt.
   Eigenes Modul ohne Abhängigkeiten: das Zuhause des Telefons liest es beim
   Start, das Leistenmodell samt Szenen lädt erst mit der Leiste. */
export const quickEdit = $state<{ id: string | null }>({ id: null });
