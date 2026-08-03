import type { ProjectSourceFile } from '../types';

function file(
  path: string,
  content = `export const ${path.replaceAll(/[^a-z0-9]/gi, '_')} = true;\n`,
): ProjectSourceFile {
  return { path, content };
}

function decoys(prefix: string, count: number): ProjectSourceFile[] {
  return Array.from({ length: count }, (_, index) =>
    file(`${prefix}/noise-${index}.ts`, `export const noise${index} = ${index};\n`),
  );
}

export function createEcommerceRepositoryFiles(): readonly ProjectSourceFile[] {
  return [
    ...decoys('src/features/unrelated', 20),
    file('prisma/schema.prisma', 'model Product {}\nmodel Order {}\nmodel Review {}\n'),
    file('src/lib/auth.ts', 'export function requireCustomerSession() {}\n'),
    file('src/lib/db.ts', 'export const db = {};\n'),
    file('src/features/products/product.service.ts', 'export function getProduct() {}\n'),
    file('src/features/products/product.types.ts', 'export type Product = { id: string };\n'),
    file('src/features/orders/order.service.ts', 'export function verifyPurchase() {}\n'),
    file(
      'src/features/orders/purchase-verification.ts',
      'export function customerPurchasedProduct() {}\n',
    ),
    file('src/app/api/products/route.ts', 'export async function GET() {}\n'),
    file('src/app/api/orders/route.ts', 'export async function POST() {}\n'),
    file('src/app/admin/moderation.ts', 'export function moderateReview() {}\n'),
    file('src/components/product-card.tsx', 'export function ProductCard() {}\n'),
    file('tests/reviews.integration.test.ts', 'test("review submission", () => {});\n'),
    file('tests/unrelated-marketing.test.ts', 'test("marketing", () => {});\n'),
    file('src/features/marketing/campaign.ts', 'export function campaign() {}\n'),
    file('package.json', '{"name":"shop","scripts":{"test":"vitest"}}\n'),
  ];
}

export function createAuthRepositoryFiles(): readonly ProjectSourceFile[] {
  return [
    ...decoys('src/features/catalog', 20),
    file('src/lib/auth.ts', 'export function signIn() {}\n'),
    file('src/lib/session.ts', 'export function createSession() {}\n'),
    file('src/middleware/auth.middleware.ts', 'export function authMiddleware() {}\n'),
    file('src/app/api/auth/route.ts', 'export async function POST() {}\n'),
    file('src/features/products/product.service.ts', 'export function getProduct() {}\n'),
    file('src/features/orders/order.service.ts', 'export function verifyPurchase() {}\n'),
  ];
}

export function createDatabaseRepositoryFiles(): readonly ProjectSourceFile[] {
  return [
    ...decoys('src/components/marketing', 20),
    file('prisma/schema.prisma', 'model Product {}\n'),
    file('migrations/001_init.sql', 'CREATE TABLE products(id text);\n'),
    file('src/repositories/product.repository.ts', 'export function saveProduct() {}\n'),
    file('src/components/product-card.tsx', 'export function ProductCard() {}\n'),
  ];
}

export function createUiRepositoryFiles(): readonly ProjectSourceFile[] {
  return [
    ...decoys('src/server/analytics', 20),
    file('src/components/product-card.tsx', 'export function ProductCard() {}\n'),
    file('src/components/review-form.tsx', 'export function ReviewForm() {}\n'),
    file('src/hooks/use-review-form.ts', 'export function useReviewForm() {}\n'),
    file('prisma/schema.prisma', 'model Product {}\n'),
  ];
}

export function createMonorepoRepositoryFiles(): readonly ProjectSourceFile[] {
  return [
    ...decoys('packages/shared/src', 20),
    file('packages/catalog/src/index.ts', 'export const catalog = true;\n'),
    file('packages/checkout/src/index.ts', 'export const checkout = true;\n'),
    file('packages/checkout/src/payment.ts', 'export function pay() {}\n'),
  ];
}

export function createLargeFilePressureRepositoryFiles(): readonly ProjectSourceFile[] {
  const giant = `${'export const filler = "product review rating summary submission moderation admin api database test";\n'.repeat(2500)}`;
  return [
    file('src/features/marketing/giant-noise.ts', giant),
    file('src/lib/auth.ts', 'export function requireCustomerSession() {}\n'),
    file(
      'src/features/orders/purchase-verification.ts',
      'export function customerPurchasedProduct() {}\n',
    ),
    file('src/app/api/products/route.ts', 'export async function GET() {}\n'),
    file('prisma/schema.prisma', 'model Review {}\n'),
  ];
}

export function createModuleFloodRepositoryFiles(): readonly ProjectSourceFile[] {
  const files: ProjectSourceFile[] = [
    file('src/lib/auth.ts', 'export function requireCustomerSession() {}\n'),
    file('prisma/schema.prisma', 'model Review {}\n'),
  ];
  for (let index = 0; index < 40; index += 1) {
    files.push(
      file(
        `src/features/products/generated-${index}.ts`,
        `export const generated${index} = ${index};\n`,
      ),
    );
  }
  return files;
}

export const ECOMMERCE_REVIEW_TASK =
  'Add product reviews. Only customers who purchased the product can review it. ' +
  'Add rating summary, review submission, moderation for admins, API endpoints, database changes and tests.';

export const AUTH_TASK =
  'Add authentication middleware and session handling for customer sign-in API endpoints.';

export const DATABASE_TASK = 'Update the database schema and migration for the repository layer.';

export const UI_TASK = 'Build a review form component page hook UI for the storefront.';

export const MONOREPO_CHECKOUT_TASK =
  'Update checkout package payment flow for the checkout service.';
