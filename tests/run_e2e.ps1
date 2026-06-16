$URL = 'https://script.google.com/macros/s/AKfycbzchn0Cmy8C3oG7z5Skm_IAXqM37bI4kDcYgGjy0M9MYnyVe0gLB2NWhFDKD4DVdx6b/exec'
Write-Host '=== NEXT NUMBER ==='
$response1 = Invoke-RestMethod -Uri $URL -Method Post -Body '{"action":"nextNumber"}' -ContentType 'application/json'
$response1 | ConvertTo-Json -Depth 10 | Write-Host

Write-Host '=== LIST BEFORE ==='
$response2 = Invoke-RestMethod -Uri $URL -Method Post -Body '{"action":"list"}' -ContentType 'application/json'
$response2 | ConvertTo-Json -Depth 5 | Write-Host

$testInv = "TEST-$(Get-Date -Format yyyyMMddHHmmss)"
$payload = @{ action = 'save'; invoice = @{ invNumber = $testInv; date = '2026-06-15'; program = 'training'; student = 'E2E Tester'; candidateAge = '25'; contact = '9876543210'; fees = @(@{ label = 'Course Fee'; amount = 1000 }); payments = @(@{ date = '2026-06-15'; amount = 1000; mode = 'Cash'; ref = 'tx01' }); academicYear = '2026-2027' } }

Write-Host '=== SAVE REQUEST ==='
($payload | ConvertTo-Json -Depth 10) | Write-Host
$response3 = Invoke-RestMethod -Uri $URL -Method Post -Body ($payload | ConvertTo-Json -Depth 10) -ContentType 'application/json'
Write-Host '=== SAVE RESPONSE ==='
$response3 | ConvertTo-Json -Depth 10 | Write-Host

Write-Host '=== LIST AFTER ==='
$response4 = Invoke-RestMethod -Uri $URL -Method Post -Body '{"action":"list"}' -ContentType 'application/json'
$response4 | ConvertTo-Json -Depth 5 | Write-Host

$created = $response4.data.invoices | Where-Object { $_.receiptNumber -eq $testInv -or $_.invNumber -eq $testInv } | Select-Object -First 1
if ($created) {
    Write-Host '=== CREATED INVOICE FOUND ==='
    $created | ConvertTo-Json -Depth 5 | Write-Host
    $deleteBody = @{ action = 'delete'; invNumber = $created.receiptNumber }
    Write-Host '=== DELETE REQUEST ==='
    ($deleteBody | ConvertTo-Json -Depth 10) | Write-Host
    $deleteResponse = Invoke-RestMethod -Uri $URL -Method Post -Body ($deleteBody | ConvertTo-Json -Depth 10) -ContentType 'application/json'
    Write-Host '=== DELETE RESPONSE ==='
    $deleteResponse | ConvertTo-Json -Depth 10 | Write-Host
} else {
    Write-Host 'CREATED INVOICE NOT FOUND'
}
