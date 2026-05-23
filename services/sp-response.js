const parseJsonSafe = (value) => {
  if (!value) {
    return null;
  }
  if (typeof value === "object") {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
};

const mapSpResult = (spOut) => {
  return {
    code: Number(spOut.o_code),
    message: spOut.o_message,
    data: parseJsonSafe(spOut.o_data_json),
  };
};

module.exports = {
  mapSpResult,
};
