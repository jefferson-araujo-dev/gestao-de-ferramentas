import fs from 'node:fs';
import path from 'node:path';

const INCLUDE_PATTERN = /^([ \t]*)<!--\s*@include\s+([^\s]+)\s*-->[ \t]*$/gm;

function expandHtmlPartials(html, currentDirectory, rootDirectory, includeStack = []) {
  const eol = html.includes('\r\n') ? '\r\n' : '\n';

  return html.replace(INCLUDE_PATTERN, (_match, indentation, requestedPath) => {
    const absolutePath = path.resolve(currentDirectory, requestedPath);
    const relativePath = path.relative(rootDirectory, absolutePath);

    const isOutsideRoot =
      relativePath === '..' ||
      relativePath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativePath);

    if (isOutsideRoot) {
      throw new Error(`O parcial HTML está fora da raiz permitida: ${requestedPath}`);
    }

    if (includeStack.includes(absolutePath)) {
      throw new Error(`Inclusão circular de parcial HTML detectada: ${requestedPath}`);
    }

    if (!fs.existsSync(absolutePath)) {
      throw new Error(`Parcial HTML não encontrado: ${requestedPath}`);
    }

    const partialHtml = fs.readFileSync(absolutePath, 'utf8');

    const expandedPartial = expandHtmlPartials(
      partialHtml,
      path.dirname(absolutePath),
      rootDirectory,
      [...includeStack, absolutePath]
    ).trim();

    return expandedPartial
      .split(/\r?\n/)
      .map((line) => (line ? `${indentation}${line}` : line))
      .join(eol);
  });
}

export function htmlPartials() {
  return {
    name: 'html-partials',
    enforce: 'pre',

    transformIndexHtml: {
      order: 'pre',

      handler(html, context) {
        if (!context?.filename) {
          throw new Error('O Vite não informou o caminho do arquivo HTML principal.');
        }

        const indexDirectory = path.dirname(context.filename);

        return expandHtmlPartials(html, indexDirectory, indexDirectory);
      },
    },

    handleHotUpdate({ file, server }) {
      const partialsDirectory = path.resolve(server.config.root, 'partials');

      const relativePath = path.relative(partialsDirectory, file);

      const isHtmlPartial =
        relativePath !== '' &&
        !relativePath.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relativePath) &&
        file.endsWith('.html');

      if (!isHtmlPartial) {
        return;
      }

      server.ws.send({
        type: 'full-reload',
      });

      return [];
    },
  };
}
