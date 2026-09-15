const getValue = (item, camelName, snakeName) => item?.[camelName] ?? item?.[snakeName];

const getLineType = (item) => String(getValue(item, "lineType", "line_type") || "");
const getLineGroupKey = (item) => String(getValue(item, "lineGroupKey", "line_group_key") || "");
const getProductId = (item) => Number(getValue(item, "productId", "product_id") || 0);
const isLegacyGroup = (groupKey) => !groupKey || groupKey.startsWith("legacy-");

const buildRuleBoundAssociation = (items = []) => {
  const sales = items.filter((item) => getLineType(item) === "sale");
  const bonuses = items.filter((item) => getLineType(item) === "bonus");
  const associatedSales = new Set();
  const associatedBonuses = new Set();

  bonuses.forEach((bonus) => {
    const bonusGroup = getLineGroupKey(bonus);
    const matchingSale = sales.find((sale) => {
      const saleGroup = getLineGroupKey(sale);
      if (!isLegacyGroup(bonusGroup) && !isLegacyGroup(saleGroup)) {
        return bonusGroup === saleGroup;
      }
      return isLegacyGroup(bonusGroup)
        && isLegacyGroup(saleGroup)
        && getProductId(bonus) > 0
        && getProductId(bonus) === getProductId(sale);
    });

    if (matchingSale) {
      associatedSales.add(matchingSale);
      associatedBonuses.add(bonus);
    }
  });

  return { associatedSales, associatedBonuses };
};

const calculateRuleBoundBonusTotal = (items = []) => {
  const { associatedBonuses } = buildRuleBoundAssociation(items);
  return items.reduce((total, item) => (
    associatedBonuses.has(item)
      ? total + Number(getValue(item, "commercialValue", "commercial_value") || 0)
      : total
  ), 0);
};

const calculateRuleBoundSaleTotal = (items = []) => {
  const { associatedSales } = buildRuleBoundAssociation(items);
  return items.reduce((total, item) => (
    associatedSales.has(item)
      ? total + Number(getValue(item, "lineTotal", "line_total") || 0)
      : total
  ), 0);
};

const calculateRuleBoundSaleFulfillmentTotal = (items = []) => {
  const { associatedSales } = buildRuleBoundAssociation(items);
  return items.reduce((total, item) => {
    if (!associatedSales.has(item)) return total;
    const quantity = Number(item.quantity || 0);
    const unitPrice = Number(getValue(item, "unitPrice", "unit_price") || 0);
    const taxPercent = Number(getValue(item, "taxPercent", "tax_percent") || 0);
    return total + quantity * unitPrice * (1 + taxPercent / 100);
  }, 0);
};

module.exports = {
  buildRuleBoundAssociation,
  calculateRuleBoundBonusTotal,
  calculateRuleBoundSaleFulfillmentTotal,
  calculateRuleBoundSaleTotal,
};
