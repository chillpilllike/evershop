const { hookable } = require('@evershop/evershop/src/lib/util/hookable');
const {
  getValueSync,
  getValue
} = require('@evershop/evershop/src/lib/util/registry');
const {
  startTransaction,
  commit,
  rollback,
  insert,
  select
} = require('@evershop/postgres-query-builder');
const {
  getConnection
} = require('@evershop/evershop/src/lib/postgres/connection');
const { getAjv } = require('../../../base/services/getAjv');
const categoryDataSchema = require('./categoryDataSchema.json');

function validateCategoryDataBeforeInsert(data) {
  const ajv = getAjv();
  categoryDataSchema.required = ['name', 'url_key'];
  const jsonSchema = getValueSync(
    'createCategoryDataJsonSchema',
    categoryDataSchema
  );
  const validate = ajv.compile(jsonSchema);
  const valid = validate(data);
  if (valid) {
    return data;
  } else {
    throw new Error(validate.errors[0].message);
  }
}

async function insertCategoryData(data, connection) {
  const parentId = data.parent_id;
  if (parentId) {
    // Load the parent category
    const parentCategory = await select()
      .from('category')
      .where('category_id', '=', parentId)
      .load(connection);

    if (!parentCategory) {
      throw new Error('Parent category not found');
    }
  }

  const result = await insert('category').given(data).execute(connection);
  const description = await insert('category_description')
    .given(data)
    .prime('category_description_category_id', result.insertId)
    .execute(connection);

  return {
    ...description,
    ...result
  };
}

/**
 * Create category service. This service will create a category with all related data
 * @param {Object} data
 * @param {Object} connection
 */
async function createCategory(data, connection) {
  const categoryData = await getValue('categoryDataBeforeCreate', data);
  // Validate category data
  validateCategoryDataBeforeInsert(categoryData);

  // Insert category data
  const category = await hookable(insertCategoryData, { connection })(
    categoryData,
    connection
  );

  return category;
}

module.exports = async (data, context) => {
  const connection = await getConnection();
  await startTransaction(connection);
  try {
    const hookContext = {
      connection
    };
    // Make sure the context is either not provided or is an object
    if (context && typeof context !== 'object') {
      throw new Error('Context must be an object');
    }
    // Merge hook context with context
    Object.assign(hookContext, context);
    const result = await hookable(createCategory, hookContext)(
      data,
      connection
    );
    await commit(connection);
    return result;
  } catch (e) {
    await rollback(connection);
    throw e;
  }
};