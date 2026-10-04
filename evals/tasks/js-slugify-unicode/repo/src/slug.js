/** Turn a title into a URL slug. */
export function slugify(title) {
    return title.toLowerCase().replace(/ /g, '-');
}
