const isSaleBonusLine = (item) => String(item?.commercial_mode || "") === "sale_bonus"
  && ["sale", "bonus"].includes(String(item?.line_type || ""));

const buildReturnableCommercialGroups = (rows = []) => {
  const groups = new Map();
  rows.forEach((row) => {
    const groupKey = isSaleBonusLine(row) && row.line_group_key
      ? `${row.order_id}:${row.product_id}:${row.line_group_key}`
      : `item:${row.order_item_id}`;
    const source = {
      order_item_id: Number(row.order_item_id),
      line_type: row.line_type,
      returnable_quantity: Number(row.returnable_quantity || 0),
    };
    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        ...row,
        commercial_label: isSaleBonusLine(row) ? "Venta + vendaje" : null,
        returnable_quantity: 0,
        source_items: [],
      });
    }
    const group = groups.get(groupKey);
    group.returnable_quantity += source.returnable_quantity;
    group.source_items.push(source);
    if (String(row.line_type) === "sale") group.order_item_id = Number(row.order_item_id);
  });
  return Array.from(groups.values()).map((group) => ({
    ...group,
    source_items: group.source_items.sort((a, b) => {
      const order = { sale: 0, bonus: 1 };
      return (order[a.line_type] ?? 2) - (order[b.line_type] ?? 2);
    }),
  })).map((group) => ({
    ...group,
    commercial_detail: group.commercial_label
      ? group.source_items
        .map((item) => `${item.line_type === "sale" ? "Venta" : "Vendaje"}: ${item.returnable_quantity}`)
        .join(" + ")
      : null,
  }));
};

const allocateReturnQuantity = (sourceItems = [], requestedQuantity) => {
  let pending = Number(requestedQuantity || 0);
  const allocations = [];
  for (const source of sourceItems) {
    if (pending <= 0) break;
    const quantity = Math.min(Number(source.returnable_quantity || 0), pending);
    if (quantity > 0) allocations.push({ order_item_id: Number(source.order_item_id), quantity });
    pending -= quantity;
  }
  return { allocations, pending };
};

module.exports = { buildReturnableCommercialGroups, allocateReturnQuantity };
