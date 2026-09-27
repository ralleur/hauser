/* Eine Heizanlage (Wärmepumpe, Kessel, Heizkreis) ist nicht die Heizung des
   Raums, in dem sie steht. Erkannt am Namen oder an der Kennung — die
   Einrichtung nutzt es für die Rolle `climate`, die Räume für ein
   hinzugefügtes Thermostat (Postfach 2026-09-27). */
export const HEATING_PLANT_NAME = /w(ä|ae|a)rme[\s_]?pumpe|heat[\s_]?pump|heizkreis|heating[\s_]?circuit|heizkessel|boiler|pompe[\s_]?(à|a)[\s_]?chaleur|pompa[\s_]?di[\s_]?calore|pompa[\s_]?ciep(ł|l)a|bomba[\s_]?de[\s_]?calor/i; // i18n-ignore: Erkennung, keine Anzeige
