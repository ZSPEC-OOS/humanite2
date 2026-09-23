import { splitParagraphs, splitSentences, tokenizeWords } from './tokenize'
import { mean, rate, round, stddev } from './util'

export interface StructuralStats {
  word_count: number
  sentence_count: number
  paragraph_count: number
  average_sentence_length: number
  sentence_length_stddev: number
  question_rate: number
}

export function computeStructuralStats(text: string): StructuralStats {
  const sentences = splitSentences(text)
  const paragraphs = splitParagraphs(text)
  const words = tokenizeWords(text)

  const sentenceLengths = sentences.map(s => tokenizeWords(s).length)
  const averageSentenceLength = mean(sentenceLengths)
  const questionCount = sentences.filter(s => s.endsWith('?')).length

  return {
    word_count: words.length,
    sentence_count: sentences.length,
    paragraph_count: paragraphs.length,
    average_sentence_length: round(averageSentenceLength),
    sentence_length_stddev: round(stddev(sentenceLengths, averageSentenceLength)),
    question_rate: round(rate(questionCount, sentences.length)),
  }
}
