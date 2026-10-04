/** Return the items on `page` (1-based) with `pageSize` items per page. */
export function paginate(items, page, pageSize) {
    const start = (page - 1) * pageSize;
    return items.slice(start, start + pageSize);
}
