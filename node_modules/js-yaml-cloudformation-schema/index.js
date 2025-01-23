'use strict';

const yaml = require('js-yaml');
const localTags = require('./tags.json');
const cloudformationTags = build(localTags, yaml);

function build(localTags, yaml) {
  function Model() {
    return function() {}
  }
  function CustomYamlType(name, kind) {
    const model = Model();
    return new yaml.Type('!'+name, {
      kind: kind,
      instanceOf: model,
      construct: function (data) {
        const obj = new model();
        // We hide the original data on the `_data` property for the `represent`
        // method to use when dumping the data...
        Object.defineProperty(obj, "_data", {
          value: data
        });
        // And we make the shape of `obj` match the JSON shape of obj
        const prefix = name === 'Ref' ? '' : 'Fn::';
        switch (kind) {
          case 'scalar':
            obj[`${prefix}${name}`] = data;
            break;
          case 'sequence':
            obj[`${prefix}${name}`] = data ? data : [];
            break;
          case 'mapping':
            obj[`${prefix}${name}`] = data ? data : {};
            break;
        }
        return obj;
      },
      represent: function(obj) {
        return obj._data;
      }
    });
  }
  let cloudformationTags = [];
  Object.keys(localTags).map((kind) => localTags[kind].map((tag) => cloudformationTags.push(new CustomYamlType(tag, kind))));
  return cloudformationTags;
}

module.exports.localTags = localTags;
module.exports.build = build;
module.exports.cloudformationTags = cloudformationTags;
module.exports.CLOUDFORMATION_SCHEMA = yaml.Schema.create(cloudformationTags);
module.exports.genSchema = function(yaml) {
    return yaml.Schema.create(build(localTags, yaml));
};
