import type { Look } from '../editor/look';
import type { LutAsset } from '../editor/cube';
import { NumberInput } from './NumberInput';

export function LookPanel({ look, luts, disabled, canImport, onImport, onSelect, onAmount, onCommit, onDownload }: {
  look: Look; luts: LutAsset[]; disabled: boolean; canImport: boolean;
  onImport: () => void; onSelect: (id: string) => void; onAmount: (amount: number, transient?: boolean) => void; onCommit: () => void; onDownload: (asset: LutAsset) => void;
}) {
  const asset = look?.kind === 'lut' ? luts.find(item => item.id === look.assetId) : undefined;
  const adjustable = !!look && (look.kind === 'lut' ? !!asset : look.supportsAmount);
  return <details class="adjustment-section look-section">
    <summary>Look &amp; LUT</summary>
    <p class="curve-help">Use a self-contained curve look or a .cube LUT made for standard RGB photos.</p>
    <div class="look-toolbar"><select aria-label="Active look" disabled={disabled} value={look?.kind === 'lut' ? look.assetId : look?.kind === 'curves' ? 'embedded' : ''} onChange={event => onSelect(event.currentTarget.value)}>
      <option value="">No look</option>
      {look?.kind === 'curves' && <option value="embedded">{look.name}</option>}
      {look?.kind === 'lut' && !asset && <option value={look.assetId}>{look.name} · file required</option>}
      {luts.map(item => <option key={item.id} value={item.id}>{item.name}{item.sessionOnly ? ' · session only' : ''}</option>)}
    </select><button class="text-button" disabled={!canImport} onClick={onImport}>Import LUT</button></div>
    {look && <>
      <div class="slider-heading"><label for="look-amount">Amount</label><div class="numeric-control"><NumberInput label="Look amount value" value={Math.round(look.amount * 100)} min={0} max={200} disabled={disabled || !adjustable} onCommit={value => onAmount(value / 100)} /><span>%</span></div></div>
      <input id="look-amount" class="exposure-slider" type="range" min="0" max="200" value={Math.round(look.amount * 100)} disabled={disabled || !adjustable} onInput={event => onAmount(event.currentTarget.valueAsNumber / 100, true)} onChange={onCommit} onPointerUp={onCommit} onPointerCancel={onCommit} onKeyUp={onCommit} onBlur={onCommit} />
      <p class="curve-help">{look.kind === 'curves' ? 'Embedded curve look. Its rendering can differ from Adobe’s profile pipeline.' : 'This LUT is a separate dependency. Keep the .cube file with exported presets.'}</p>
      {look.kind === 'curves' && !look.supportsAmount && <p class="curve-help">This look fixes its amount at 100%.</p>}
      {asset && <button class="text-button" onClick={() => onDownload(asset)}>Download original LUT</button>}
    </>}
  </details>;
}
