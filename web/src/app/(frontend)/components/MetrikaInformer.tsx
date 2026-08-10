import React from 'react'

import { METRIKA_ID } from '../../../lib/metrika'

// Штатный информер Метрики — картинка с числами за сегодня, которую отдаёт сам
// Яндекс по номеру счётчика.
//
// Зачем он рядом с нашим блоком «сегодня / вчера»: наш блок ходит в Reporting
// API и потому требует OAuth-токена, а видимая цифра посещаемости — требование
// владельца (D-017), которое не должно ждать выдачи токена. Информеру хватает
// номера счётчика, поэтому он появляется сразу и остаётся запасным вариантом,
// если токен протухнет.
export function MetrikaInformer() {
  if (!METRIKA_ID) return null

  return (
    <a
      className="site-footer__informer"
      href={`https://metrika.yandex.ru/stat/?id=${METRIKA_ID}&from=informer`}
      target="_blank"
      rel="nofollow noopener"
    >
      {/* Внешний трекинг-домен, фиксированные 88×31 — next/image здесь неприменим. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`https://informer.yandex.ru/informer/${METRIKA_ID}/3_1_FFFFFFFF_EFEFEFFF_0_pageviews`}
        alt="Яндекс.Метрика"
        title="Яндекс.Метрика: данные за сегодня — просмотры, визиты и уникальные посетители"
        width={88}
        height={31}
        style={{ border: 0 }}
      />
    </a>
  )
}
