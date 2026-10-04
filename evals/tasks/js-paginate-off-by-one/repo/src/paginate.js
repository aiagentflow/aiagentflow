/** Return the items on `page` (1-based) with `pageSize` items per page. */
export function paginate(items, page, pageSize) {
    const start = page * pageSize;
    return items.slice(start, start + pageSize);
}
