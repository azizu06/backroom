import type { Role, Specialist } from '../contracts';

/** Role registry the dispatcher reads. Role workers: export your Specialist from
 * `./<role>.ts`, import it here and add one line to the object below. A role that is
 * not registered stops its case as held (`ROLE_NOT_REGISTERED:<ROLE>`), never guessed. */
export const specialists: Partial<Record<Role, Specialist>> = {
};
