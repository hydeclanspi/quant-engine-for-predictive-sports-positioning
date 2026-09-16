import { Children, cloneElement, isValidElement } from 'react'

// Repositions the existing elements; no duplicate controls or business state.
export default function PortfolioComposition({
  inspiration,
  main,
  secondary,
  algorithm,
  details,
}) {
  if (!inspiration) return <>{main}{details}{secondary}{algorithm}</>

  const [candidates, smartPackage] = Children.toArray(main.props.children).filter(isValidElement)
  const [ranking, layers] = Children.toArray(secondary.props.children).filter(isValidElement)
  return (
    <>
      <div
        className={`portfolio-primary-grid ${main.props.className}`}
        data-left-collapsed={main.props.className.includes('combo-left-collapsed')}
      >
        {cloneElement(candidates, { key: 'candidates' })}
        {cloneElement(smartPackage, { key: 'package' })}
        {cloneElement(layers, { key: 'layers' })}
      </div>
      <div className="portfolio-research-grid">
        {cloneElement(ranking, { key: 'ranking' })}
        {cloneElement(algorithm, { key: 'algorithm' })}
      </div>
      {details}
    </>
  )
}
