import { GeminiProvider } from '../adapter';
import { GeminiRequestMapper } from '../mapper';
import {
  CORRECTION_OUTPUT_BOUNDING_METADATA,
  TRUNCATION_RETRY_MAX_DIAGNOSTICS,
  TRUNCATION_RETRY_MAX_SUMMARY_CHARACTERS,
  TRUNCATION_RETRY_METADATA_ALLOWLIST,
  TRUNCATION_RETRY_METADATA_COMPACTION,
} from '../../../core/prompt-orchestrator';
import { createGeminiConfiguration, createGeminiRequest } from './gemini-provider.fixture';

describe('GeminiRequestMapper truncation retry schema bounding (ADR-029 Option B)', () => {
  const servicePath = 'src/application/workspace/activity-history.service.ts';
  const testPath = 'src/application/workspace/activity-history.service.test.ts';
  const allowlist = [testPath, servicePath] as const;

  function createMapper(): GeminiRequestMapper {
    const configuration = createGeminiConfiguration();
    const provider = new GeminiProvider(configuration, {
      generateContent: async () => ({}),
    });
    return new GeminiRequestMapper(provider.descriptor, configuration);
  }

  it('leaves ordinary attempt 1 schema unchanged without bounding metadata', async () => {
    const mapper = createMapper();
    const request = await createGeminiRequest();
    const mapped = mapper.map(request);
    const schema = mapped.config.responseJsonSchema;

    expect(schema.properties?.artifacts).toMatchObject({
      type: 'array',
      items: {
        properties: {
          logicalPath: {
            type: 'string',
            description: expect.stringContaining('Normalized repository-relative POSIX path'),
          },
        },
      },
    });
    expect(schema.properties?.artifacts).not.toHaveProperty('maxItems');
    expect(schema.properties?.artifacts?.items?.properties?.logicalPath).not.toHaveProperty('enum');
    expect(schema.properties?.diagnostics).not.toHaveProperty('maxItems');
    expect(schema.properties?.summary).not.toHaveProperty('maxLength');
  });

  it('bounds correction attempt 1 schema from correction-output-bounding metadata', async () => {
    const mapper = createMapper();
    const request = await createGeminiRequest({
      metadata: {
        [CORRECTION_OUTPUT_BOUNDING_METADATA]: true,
        [TRUNCATION_RETRY_METADATA_ALLOWLIST]: allowlist.join('\u001f'),
      },
    });
    const mapped = mapper.map(request);
    const schema = mapped.config.responseJsonSchema;

    expect(schema.properties?.artifacts).toMatchObject({
      type: 'array',
      maxItems: allowlist.length,
      items: {
        properties: {
          logicalPath: {
            type: 'string',
            enum: [...allowlist],
          },
        },
      },
    });
    expect(schema.properties?.diagnostics).toMatchObject({
      type: 'array',
      maxItems: TRUNCATION_RETRY_MAX_DIAGNOSTICS,
    });
    expect(schema.properties?.summary).toMatchObject({
      type: 'string',
      maxLength: TRUNCATION_RETRY_MAX_SUMMARY_CHARACTERS,
    });
  });

  it('bounds compacted attempt 2 schema to the allowlist cardinality', async () => {
    const mapper = createMapper();
    const request = await createGeminiRequest({
      metadata: {
        [TRUNCATION_RETRY_METADATA_COMPACTION]: true,
        [TRUNCATION_RETRY_METADATA_ALLOWLIST]: allowlist.join('\u001f'),
      },
    });
    const mapped = mapper.map(request);
    const schema = mapped.config.responseJsonSchema;

    expect(schema.properties?.artifacts).toMatchObject({
      type: 'array',
      maxItems: allowlist.length,
      items: {
        properties: {
          logicalPath: {
            type: 'string',
            enum: [...allowlist],
          },
          content: {
            type: 'string',
            description: expect.stringContaining('Complete target file content'),
          },
        },
      },
    });
    expect(schema.properties?.artifacts?.items?.properties?.content).not.toHaveProperty(
      'maxLength',
    );
    expect(schema.properties?.diagnostics).toMatchObject({
      type: 'array',
      maxItems: TRUNCATION_RETRY_MAX_DIAGNOSTICS,
    });
    expect(schema.properties?.summary).toMatchObject({
      type: 'string',
      maxLength: TRUNCATION_RETRY_MAX_SUMMARY_CHARACTERS,
    });
  });
});
