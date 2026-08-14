"""Een Supabase-dubbel dat genoeg van PostgREST nabootst om logica te testen.

Bewust in-memory: de tests moeten de beslisregels controleren, niet de database.
Wat hier niet wordt ondersteund, hoort ook niet in de geteste code te zitten.
"""

from __future__ import annotations

from itertools import count
from typing import Any


# Unieke kolommen die de echte database afdwingt en die logica hier draagt.
UNIQUE: dict[str, tuple[str, ...]] = {
    "notifications": ("dedupe_key",),
    "push_subscriptions": ("endpoint",),
    "coach_runs": ("trigger_key",),
}


class _Result:
    def __init__(self, data: list[dict[str, Any]]) -> None:
        self.data = data


class _Query:
    def __init__(self, store: "FakeSB", table: str) -> None:
        self.store = store
        self.table_name = table
        self.filters: list[tuple[str, str, Any]] = []
        self.order_by: tuple[str, bool] | None = None
        self.limit_to: int | None = None
        self.action: str = "select"
        self.payload: Any = None

    # --- opbouw -----------------------------------------------------------
    def select(self, _columns: str = "*", **_kwargs: Any) -> "_Query":
        return self

    def eq(self, column: str, value: Any) -> "_Query":
        self.filters.append((column, "eq", value))
        return self

    def neq(self, column: str, value: Any) -> "_Query":
        self.filters.append((column, "neq", value))
        return self

    def gte(self, column: str, value: Any) -> "_Query":
        self.filters.append((column, "gte", value))
        return self

    def lte(self, column: str, value: Any) -> "_Query":
        self.filters.append((column, "lte", value))
        return self

    def lt(self, column: str, value: Any) -> "_Query":
        self.filters.append((column, "lt", value))
        return self

    def in_(self, column: str, values: list[Any]) -> "_Query":
        self.filters.append((column, "in", values))
        return self

    @property
    def not_(self) -> "_Not":
        return _Not(self)

    def order(self, column: str, desc: bool = False) -> "_Query":
        self.order_by = (column, desc)
        return self

    def limit(self, value: int) -> "_Query":
        self.limit_to = value
        return self

    def update(self, payload: dict[str, Any]) -> "_Query":
        self.action = "update"
        self.payload = payload
        return self

    def insert(self, payload: Any) -> "_Query":
        self.action = "insert"
        self.payload = payload
        return self

    # --- uitvoeren --------------------------------------------------------
    def _matches(self, row: dict[str, Any]) -> bool:
        for column, op, value in self.filters:
            actual = row.get(column)
            if op == "eq" and actual != value:
                return False
            if op == "neq" and actual == value:
                return False
            if op == "in" and actual not in value:
                return False
            if op == "not_null" and actual is None:
                return False
            if op in {"gte", "lte", "lt"}:
                if actual is None:
                    return False
                left, right = str(actual), str(value)
                if op == "gte" and not left >= right:
                    return False
                if op == "lte" and not left <= right:
                    return False
                if op == "lt" and not left < right:
                    return False
        return True

    def execute(self) -> _Result:
        rows = self.store.rows.setdefault(self.table_name, [])

        if self.action == "insert":
            added = self.payload if isinstance(self.payload, list) else [self.payload]
            written = []
            for item in added:
                # Unieke kolommen echt afdwingen. Idempotentie via dedupe_key
                # leunt volledig op de database, dus een dubbel zonder fout zou
                # in een test slagen en in productie een tweede melding sturen.
                for column in UNIQUE.get(self.table_name, ()):
                    value = item.get(column)
                    if value is None:
                        continue
                    if any(r.get(column) == value for r in rows):
                        raise RuntimeError(
                            f'duplicate key value violates unique constraint '
                            f'"{self.table_name}_{column}_key" (23505)'
                        )
                row = {"id": next(self.store.ids), **item}
                rows.append(row)
                written.append(row)
            self.store.inserted.append((self.table_name, written))
            return _Result(written)

        selected = [row for row in rows if self._matches(row)]

        if self.action == "update":
            for row in selected:
                row.update(self.payload)
            self.store.updated.append((self.table_name, self.payload, len(selected)))
            return _Result(selected)

        if self.order_by:
            column, desc = self.order_by
            selected = sorted(
                selected, key=lambda r: (r.get(column) is None, str(r.get(column))), reverse=desc
            )
        if self.limit_to is not None:
            selected = selected[: self.limit_to]
        return _Result([dict(row) for row in selected])


class _Not:
    """`.not_.is_(column, "null")` uit PostgREST."""

    def __init__(self, query: _Query) -> None:
        self.query = query

    def is_(self, column: str, value: str) -> _Query:
        if value != "null":
            raise NotImplementedError(f"not_.is_ ondersteunt alleen 'null', niet {value!r}")
        self.query.filters.append((column, "not_null", None))
        return self.query


class FakeSB:
    def __init__(self, rows: dict[str, list[dict[str, Any]]] | None = None) -> None:
        self.rows = {name: [dict(r) for r in items] for name, items in (rows or {}).items()}
        self.ids = count(1000)
        self.updated: list[tuple[str, dict[str, Any], int]] = []
        self.inserted: list[tuple[str, list[dict[str, Any]]]] = []

    def table(self, name: str) -> _Query:
        return _Query(self, name)

    def row(self, table: str, row_id: int) -> dict[str, Any]:
        return next(r for r in self.rows.get(table, []) if r.get("id") == row_id)
