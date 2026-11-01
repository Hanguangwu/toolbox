#!/usr/bin/env node
/**
 * 站点地址解析单测：确保 canonical / sitemap 只依赖这一条优先级链。
 * 用法：node scripts/test-site-url.mjs
 */
import assert from 'node:assert/strict';
import {
  normalizeSiteUrl,
  resolveSiteUrl,
  resolveSiteUrlForBuild,
  isLocalUrl,
} from './site-url.mjs';

let pass = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ok   ${name}`);
  } catch (e) {
    failures.push({ name, message: e.message });
    console.log(`  FAIL ${name}`);
    console.log(`       ${e.message.split('\n')[0]}`);
  }
}

console.log('\n归一化');

check('裸域名补 https', () => {
  assert.equal(normalizeSiteUrl('example.com'), 'https://example.com');
});

check('去掉尾部斜杠', () => {
  assert.equal(normalizeSiteUrl('https://example.com/'), 'https://example.com');
});

check('保留子路径（Pages 镜像）', () => {
  assert.equal(normalizeSiteUrl('https://user.github.io/toolbox/'), 'https://user.github.io/toolbox');
});

check('保留 http 协议（本地）', () => {
  assert.equal(normalizeSiteUrl('http://localhost:4321'), 'http://localhost:4321');
});

check('空值与垃圾输入返回空串', () => {
  assert.equal(normalizeSiteUrl('   '), '');
  assert.equal(normalizeSiteUrl(undefined), '');
  assert.equal(normalizeSiteUrl('http://'), '');
});

console.log('\n优先级链');

check('SITE_URL 最高优先', () => {
  const env = {
    SITE_URL: 'https://tools.example.dev',
    VERCEL_PROJECT_PRODUCTION_URL: 'toolbox.vercel.app',
    VERCEL_URL: 'toolbox-abc123.vercel.app',
  };
  assert.equal(resolveSiteUrl(env), 'https://tools.example.dev');
});

check('无 SITE_URL 时用 Vercel 生产域名（即自定义域名）', () => {
  const env = {
    VERCEL_PROJECT_PRODUCTION_URL: 'mytools.example.com',
    VERCEL_URL: 'toolbox-abc123.vercel.app',
  };
  assert.equal(resolveSiteUrl(env), 'https://mytools.example.com');
});

check('预览部署没有生产域名时退到 VERCEL_URL', () => {
  assert.equal(resolveSiteUrl({ VERCEL_URL: 'toolbox-abc123.vercel.app' }), 'https://toolbox-abc123.vercel.app');
});

check('什么都没有时回落到本地地址', () => {
  assert.equal(resolveSiteUrl({}), 'http://localhost:4321');
});

check('SITE_URL 为空串时不参与覆盖', () => {
  assert.equal(
    resolveSiteUrl({ SITE_URL: '', VERCEL_PROJECT_PRODUCTION_URL: 'mytools.example.com' }),
    'https://mytools.example.com'
  );
});

console.log('\nCI 守卫');

check('CI 中解析到 localhost 直接失败', () => {
  assert.throws(() => resolveSiteUrlForBuild({ CI: '1' }), /localhost/);
});

check('GITHUB_PAGES_URL 兜底（Pages 镜像构建）', () => {
  assert.equal(
    resolveSiteUrlForBuild({ CI: '1', GITHUB_PAGES_URL: 'https://hanguangwu.github.io/toolbox' }),
    'https://hanguangwu.github.io/toolbox'
  );
});

check('CI 中 GITHUB_PAGES_URL 可替代 Vercel 变量', () => {
  assert.equal(
    resolveSiteUrlForBuild({ CI: '1', GITHUB_PAGES_URL: 'hanguangwu.github.io/toolbox' }),
    'https://hanguangwu.github.io/toolbox'
  );
});

check('CI 中拿到真实域名则通过', () => {
  assert.equal(
    resolveSiteUrlForBuild({ CI: '1', VERCEL_PROJECT_PRODUCTION_URL: 'mytools.example.com' }),
    'https://mytools.example.com'
  );
});

check('CI 中 SITE_URL 可覆盖 Vercel 变量', () => {
  assert.equal(
    resolveSiteUrlForBuild({
      CI: '1',
      SITE_URL: 'https://user.github.io/toolbox',
      VERCEL_PROJECT_PRODUCTION_URL: 'mytools.example.com',
    }),
    'https://user.github.io/toolbox'
  );
});

check('本地构建不抛错', () => {
  assert.equal(resolveSiteUrlForBuild({}), 'http://localhost:4321');
});

check('isLocalUrl 识别回环地址', () => {
  assert.equal(isLocalUrl('http://localhost:4321'), true);
  assert.equal(isLocalUrl('http://127.0.0.1:4321'), true);
  assert.equal(isLocalUrl('https://mytools.example.com'), false);
  assert.equal(isLocalUrl('not a url'), false);
});

console.log(`\n${failures.length ? '❌' : '✅'} ${pass} 通过 / ${failures.length} 失败\n`);
if (failures.length) {
  for (const f of failures) console.log(`- ${f.name}\n  ${f.message}`);
  process.exit(1);
}
