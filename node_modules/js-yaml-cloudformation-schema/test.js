const fs = require('fs');
const path = require('path');
const util = require('util');
const yaml = require('js-yaml');
const CLOUDFORMATION_SCHEMA = require('./index').CLOUDFORMATION_SCHEMA;
const expected = require('./test.json');
const assert = require('assert');
fs.readFile(path.join(__dirname, 'test.yml'), 'utf8', function (error, data) {
  assert.ifError(error);
  assert.doesNotThrow(() => {
    const loaded = yaml.load(data, { schema: CLOUDFORMATION_SCHEMA });
    assert.deepEqual(loaded, expected);
    console.log(util.inspect(loaded, false, 20, true));
    const dumped = yaml.dump(loaded, { schema: CLOUDFORMATION_SCHEMA });
    // Unfortunately, this assertion is not true. See: https://github.com/nodeca/js-yaml/issues/576
    // assert.strictEqual(dumped, data);
    console.log(dumped);
    const newloaded = yaml.load(yaml.dump(loaded, { schema: CLOUDFORMATION_SCHEMA}), {schema: CLOUDFORMATION_SCHEMA});
    assert.deepEqual(newloaded, expected);
    console.log(util.inspect(newloaded, false, 20, true));
  })
});
