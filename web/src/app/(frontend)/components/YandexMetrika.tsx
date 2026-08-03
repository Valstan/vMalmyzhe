import Script from 'next/script'
import React from 'react'

import { METRIKA_ID } from '../../../lib/metrika'

// JS-счётчик Яндекс.Метрики. Без NEXT_PUBLIC_YANDEX_METRIKA_ID не рендерится
// вовсе — на локальной разработке и в CI лишних запросов нет.
//
// ЛайвИнтернет намеренно не ставим (решение владельца 2026-08-03): аналитику
// даёт Метрика, а второй скрипт на каждой странице ради дублирующей цифры —
// лишний вес и лишний внешний домен.
export function YandexMetrika() {
  if (!METRIKA_ID) return null

  return (
    <>
      <Script id="yandex-metrika" strategy="afterInteractive">
        {`(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
        m[i].l=1*new Date();
        for (var j = 0; j < document.scripts.length; j++) {if (document.scripts[j].src === r) { return; }}
        k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})
        (window, document, "script", "https://mc.yandex.ru/metrika/tag.js", "ym");
        ym(${JSON.stringify(METRIKA_ID)}, "init", {
          clickmap: true,
          trackLinks: true,
          accurateTrackBounce: true,
          webvisor: false
        });`}
      </Script>
      <noscript>
        <div>
          {/* Счётчик-пиксель Метрики, а не картинка: next/image здесь неприменим
              (внешний трекинг-домен, 1×1, внутри noscript). */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`https://mc.yandex.ru/watch/${METRIKA_ID}`}
            style={{ position: 'absolute', left: '-9999px' }}
            alt=""
          />
        </div>
      </noscript>
    </>
  )
}
