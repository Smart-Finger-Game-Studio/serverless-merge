# js-yaml-cloudformation-schema [![Build Status](https://travis-ci.org/danmactough/js-yaml-cloudformation-schema.svg?branch=master)](https://travis-ci.org/danmactough/js-yaml-cloudformation-schema)

Schema to allow js-yaml to process YAML formatted CloudFormation templates that use short form syntax for [intrinsic functions](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/intrinsic-function-reference.html) while parsing or dumping, for example: `!Ref`, `!Base64`.

See [tags.json](./tags.json) for currently supported short form syntax for intrinsic functions, also known as [local tags](https://yaml.org/spec/1.2/spec.html#tag/local/) in the YAML spec.

This is a fork of [yyolk/cloudformation-js-yaml-schema](https://github.com/yyolk/cloudformation-js-yaml-schema) that changes the structure of the parsed JavaScript representation of the CloudFormation template to match the parsed representation of a JSON formatted CloudFormation template.

## Usage

```js
const yaml = require('js-yaml');
const { CLOUDFORMATION_SCHEMA } = require('js-yaml-cloudformation-schema');

let templateBody = fs.readFileSync(templatePath, 'utf8');
templateBody = yaml.safeLoad(templateBody, { schema: CLOUDFORMATION_SCHEMA });
console.log(JSON.stringify(templateBody, null, 2));

templateBody = yaml.safeDump(templateBody, { schema: CLOUDFORMATION_SCHEMA });
console.log(templateBody);
```
