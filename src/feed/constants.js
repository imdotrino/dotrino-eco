// Constantes compartidas por el feed y los servicios (para que no haya dos copias
// de «cuánto vive un eco» que un día digan cosas distintas).

/** Vida de un eco: la del beacon geo. Lo público del content vive lo mismo. */
export const TTL_24H = 24 * 60 * 60 * 1000
