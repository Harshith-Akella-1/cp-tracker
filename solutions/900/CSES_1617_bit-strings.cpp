// Bit Strings (CSES, rating 900)
// https://cses.fi/problemset/task/1617
// Accepted 23/10/2026

#include <bits/stdc++.h>
using namespace std;

int main(){
    int n;
    cin >> n;

    long long m = 1000000007;

    long long r = 2%m;


    for(int i=1;i<n;i++){
         r = (r*2)%m;   

    }

    cout << r << endl;



    return 0;
}
