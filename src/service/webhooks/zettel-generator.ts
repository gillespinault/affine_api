/**
 * Zettel Generator
 * Generates atomic knowledge units (zettels) from article content using Gemini AI
 */

export interface Zettel {
  title: string;
  body: string;
  tags: string[];
}

export interface ZettelGeneratorConfig {
  apiKey: string;
  model?: string;
  maxZettels?: number;
  language?: string;
}

const SYSTEM_PROMPT = `Tu es un expert en extraction de connaissances et en méthode Zettelkasten.

Ta tâche est d'extraire des "zettels" (notes atomiques) à partir d'un article.

Règles pour chaque zettel:
1. **Atomicité**: Une seule idée par zettel
2. **Autonomie**: Compréhensible sans contexte
3. **Titre interrogatif**: Formulé comme une question
4. **Corps concis**: 2-4 phrases maximum
5. **Tags pertinents**: 2-5 tags par zettel

Format de sortie JSON:
{
  "zettels": [
    {
      "title": "Quelle est l'idée principale ?",
      "body": "Explication concise de l'idée en 2-4 phrases.",
      "tags": ["tag1", "tag2"]
    }
  ]
}

Extrais entre 3 et 8 zettels selon la richesse du contenu.
Réponds UNIQUEMENT avec le JSON, sans texte additionnel.`;

export class ZettelGenerator {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly maxZettels: number;
  private readonly language: string;

  constructor(config: ZettelGeneratorConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? 'gemini-2.0-flash-exp';
    this.maxZettels = config.maxZettels ?? 8;
    this.language = config.language ?? 'french';
  }

  /**
   * Generate zettels from article content
   */
  async generate(content: string, options?: {
    title?: string;
    summary?: string;
    url?: string;
    existingTags?: string[];
  }): Promise<Zettel[]> {
    if (!content || content.trim().length < 100) {
      return [];
    }

    const userPrompt = this.buildPrompt(content, options);

    try {
      const response = await this.callGemini(userPrompt);
      const zettels = this.parseResponse(response);
      return zettels.slice(0, this.maxZettels);
    } catch (error) {
      console.error('Zettel generation failed:', error);
      return [];
    }
  }

  private buildPrompt(content: string, options?: {
    title?: string;
    summary?: string;
    url?: string;
    existingTags?: string[];
  }): string {
    const parts: string[] = [];

    if (options?.title) {
      parts.push(`# Titre de l'article\n${options.title}`);
    }

    if (options?.url) {
      parts.push(`# URL source\n${options.url}`);
    }

    if (options?.summary) {
      parts.push(`# Résumé existant\n${options.summary}`);
    }

    if (options?.existingTags?.length) {
      parts.push(`# Tags existants (pour inspiration)\n${options.existingTags.join(', ')}`);
    }

    // Truncate content if too long (Gemini context limit)
    const maxContentLength = 30000;
    const truncatedContent = content.length > maxContentLength
      ? content.slice(0, maxContentLength) + '\n\n[... contenu tronqué]'
      : content;

    parts.push(`# Contenu de l'article\n${truncatedContent}`);

    return parts.join('\n\n');
  }

  private async callGemini(userPrompt: string): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: `${SYSTEM_PROMPT}\n\n---\n\n${userPrompt}` }],
          },
        ],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 4096,
          responseMimeType: 'application/json',
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gemini API error ${response.status}: ${error}`);
    }

    const data = await response.json() as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string }>;
        };
      }>;
    };

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error('No content in Gemini response');
    }

    return text;
  }

  private parseResponse(response: string): Zettel[] {
    try {
      // Try to parse as JSON
      const parsed = JSON.parse(response) as { zettels?: Zettel[] };

      if (!parsed.zettels || !Array.isArray(parsed.zettels)) {
        console.warn('Invalid zettel response format');
        return [];
      }

      // Validate each zettel
      return parsed.zettels.filter(z =>
        typeof z.title === 'string' && z.title.length > 0 &&
        typeof z.body === 'string' && z.body.length > 0 &&
        Array.isArray(z.tags)
      ).map(z => ({
        title: z.title.trim(),
        body: z.body.trim(),
        tags: z.tags.filter((t: unknown): t is string => typeof t === 'string').map(t => t.trim()),
      }));
    } catch (error) {
      console.error('Failed to parse zettel response:', error);
      return [];
    }
  }
}
