import assert from 'node:assert/strict';
import { health } from '../server/app';

assert.equal(health(), 'Hello, zyro-style-fixture');
